import { uploadBlobFile } from '../utils/blobUpload.js';
const documentModule = assistOS.loadModule("document");

function getContext(element) {
    const rawContext = element.getAttribute("data-context") || "{}";
    try {
        return JSON.parse(decodeURIComponent(rawContext));
    } catch (error) {
        console.error("Invalid chapter context", error);
        return {};
    }
}

const formatFileSize = (size = 0) => {
    if (!size) {
        return "0 B";
    }
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
    const value = size / Math.pow(1024, index);
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
};

export class ImagePlugin {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        const context = getContext(this.element);
        this.chapterId = context.chapterId || this.element.getAttribute("data-chapter-id");
        this.paragraphId = context.paragraphId || this.element.getAttribute("data-paragraph-id");
        this.hostSelector = context.hostSelector || "";
        this.hostType = context.hostType || "";
        const documentViewPage = document.querySelector("document-view-page");
        this.documentPresenter = documentViewPage?.webSkelPresenter ?? null;
        if (!this.documentPresenter || !this.documentPresenter._document) {
            throw new Error("Document context is required for image plugin.");
        }
        this._document = this.documentPresenter._document;
        this.chapter = this._document.chapters.find((chapter) => chapter.id === this.chapterId);
        if (!Array.isArray(this.chapter.variables)) {
            this.chapter.variables = [];
        }
        if (this.paragraphId) {
            this.isParagraphContext = true;
            this.paragraph = this.chapter.paragraphs?.find((paragraph) => paragraph.id === this.paragraphId) || null;
            if (!this.paragraph) {
                throw new Error(`Paragraph ${this.paragraphId} not found.`);
            }
        } else {
            this.isParagraphContext = false;
            this.ensureBackgroundImageHydrated();
        }
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.fileInput = this.element.querySelector(".file-input");
        this.resetFileInputListener();
        this.imageListElement = this.element.querySelector('.image-list');
        await this.populateExistingImages();
    }

    resetFileInputListener() {
        this.fileInput.addEventListener("change", this.uploadImageAttachment.bind(this), { once: true });
    }

    uploadImageAttachment(event) {
        const file = event.target.files[0];
        const maxFileSize = 100 * 1024 * 1024;
        if (!file) {
            return;
        }
        if (file.size > maxFileSize) {
            return showApplicationError("The file is too large.", "Maximum file size is 100MB.", "");
        }
        const handleError = (error) => {
            console.error("Failed to upload image", error);
            assistOS.showToast("Failed to upload image.", "error");
            this.resetFileInputListener();
        };
        try {
            const uploadPromise = uploadBlobFile(file);
            const imageElement = new Image();
            const objectUrl = URL.createObjectURL(file);
            imageElement.addEventListener("load", async () => {
                try {
                    const uploadResult = await uploadPromise;
                    const metadata = {
                        id: uploadResult.id ?? uploadResult.filename ?? `image-${Date.now()}`,
                        width: imageElement.naturalWidth,
                        height: imageElement.naturalHeight,
                        size: file.size,
                        path: uploadResult.downloadUrl,
                        name: uploadResult.filename || file.name
                    };
                    await this.persistImageAttachment(metadata);
                    await this.invalidateCompiledVideo();
                    await this.populateExistingImages();
                    this.resetFileInputListener();
                    assistOS.showToast("Image saved.", "success");
                } catch (error) {
                    handleError(error);
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            });
            imageElement.addEventListener("error", () => {
                URL.revokeObjectURL(objectUrl);
                handleError(new Error("Unable to read image metadata."));
            });
            imageElement.src = objectUrl;
        } catch (error) {
            handleError(error);
        }
        this.fileInput.value = "";
    }

    insertImage() {
        this.fileInput.click();
    }

    async closeModal() {
        const presenter = this.getHostPresenter();
        if (presenter?.closePlugin) {
            await presenter.closePlugin("", false);
        } else {
            this.resetPluginButtonState();
        }
        assistOS.UI.closeModal(this.element);
        this.requestChapterRerender();
    }

    resetPluginButtonState() {
        const pluginIcon = this.getPluginIconElement();
        if (pluginIcon) {
            pluginIcon.classList.remove("chapter-highlight-plugin");
        }
    }

    async invalidateCompiledVideo() {
        if (this.isParagraphContext) {
            return;
        }
        if (this.chapter.commands.compileVideo) {
            delete this.chapter.commands.compileVideo;
            await documentModule.updateChapterCommands(this._document.id, this.chapter.id, this.chapter.commands);
        }
    }

    async populateExistingImages() {
        await this.renderImageList();
        this.refreshChapterPreviewIcons();
    }

    getImageAttachments() {
        if (this.isParagraphContext) {
            if (Array.isArray(this.paragraph?.mediaAttachments?.image) && this.paragraph.mediaAttachments.image.length) {
                return this.paragraph.mediaAttachments.image;
            }
            return [];
        }
        if (Array.isArray(this.chapter.mediaAttachments?.image) && this.chapter.mediaAttachments.image.length) {
            return this.chapter.mediaAttachments.image;
        }
        return this.chapter.backgroundImage ? [this.chapter.backgroundImage] : [];
    }

    async renderImageList() {
        const container = this.imageListElement;
        if (!container) {
            return;
        }
        const attachments = this.getImageAttachments();
        if (!attachments.length) {
            container.innerHTML = '<div class="image-empty-state">No images yet.</div>';
            return;
        }
        container.innerHTML = attachments.map((item, index) => this.renderImageItemTemplate(item, index)).join('');
    }

    renderImageItemTemplate(item, index) {
        const sanitize = (value) => typeof assistOS?.UI?.sanitize === 'function' ? assistOS.UI.sanitize(value) : value;
        const escapeAttr = (value) => {
            if (value === undefined || value === null) {
                return '';
            }
            return String(value).replace(/"/g, '&quot;');
        };
        const title = sanitize(item.name || item.filename || item.id || `Image ${index + 1}`);
        const url = sanitize(item.url || item.path || '');
        const sizeLabel = formatFileSize(item.size);
        const dimensions = item.width && item.height ? `${item.width}×${item.height}` : '--';
        const identifier = typeof item.identifier === 'string' ? item.identifier : '';
        const identifierAttr = escapeAttr(identifier);
        const deleteAction = identifier ? `deleteImageItem ${identifier}` : 'deleteImageItem';
        const deleteActionAttr = escapeAttr(deleteAction);
        return `
        <div class="image-item" data-identifier="${identifierAttr}">
            <div class="image-item-header">
                <span>${title}</span>
                <span>${dimensions}</span>
            </div>
            <div class="image-item-preview">
                <img loading="lazy" src="${url}" alt="${title}">
            </div>
            <div class="image-item-details">
                ${sizeLabel !== '0 B' ? `<div><strong>Size:</strong> ${sizeLabel}</div>` : ''}
                ${dimensions !== '--' ? `<div><strong>Dimensions:</strong> ${dimensions}</div>` : ''}
            </div>
            <div class="image-item-actions">
                <button class="general-button danger" type="button" data-local-action="${deleteActionAttr}">Delete</button>
            </div>
        </div>`;
    }

    async deleteImageItem(triggerElement, identifier) {
        const container = triggerElement?.closest('.image-item');
        const targetIdentifier = identifier || container?.dataset?.identifier;
        if (!targetIdentifier) {
            return;
        }
        try {
            if (this.isParagraphContext) {
                await documentModule.deleteParagraphImageAttachment(
                    this._document.id,
                    this.chapter.id,
                    this.paragraph.id,
                    targetIdentifier
                );
            } else {
                await documentModule.deleteChapterImageAttachment(this._document.id, this.chapter.id, targetIdentifier);
            }
            await this.invalidateCompiledVideo();
            await this.populateExistingImages();
            assistOS.showToast('Image removed.', 'info');
        } catch (error) {
            console.error('Failed to delete image', error);
            assistOS.showToast('Failed to delete image.', 'error');
        }
    }

    async persistImageAttachment(payload) {
        if (this.isParagraphContext) {
            return documentModule.setParagraphImageAttachment(
                this._document.id,
                this.chapter.id,
                this.paragraph.id,
                payload
            );
        }
        return documentModule.setChapterImageAttachment(
            this._document.id,
            this.chapter.id,
            payload
        );
    }

    ensureBackgroundImageHydrated() {
        this.chapter.mediaAttachments = this.chapter.mediaAttachments || {};
        if (!Array.isArray(this.chapter.mediaAttachments.image)) {
            this.chapter.mediaAttachments.image = [];
        }
    }

    getPluginIconElement() {
        const hostElement = this.getHostElement();
        if (!hostElement) {
            return null;
        }
        return hostElement.querySelector(`.icon-container.${this.element.tagName.toLowerCase()}`);
    }

    refreshChapterPreviewIcons() {
        const chapterPresenter = this.getHostPresenter();
        if (chapterPresenter?.renderInfoIcons) {
            chapterPresenter.renderInfoIcons();
        }
    }

    requestChapterRerender() {
        const presenter = this.getHostPresenter();
        if (presenter?.invalidate) {
            presenter.invalidate();
        } else if (this.documentPresenter?.invalidate) {
            this.documentPresenter.invalidate();
        }
    }

    getHostPresenter() {
        const hostElement = this.getHostElement();
        return hostElement?.webSkelPresenter || null;
    }

    getHostElement() {
        return this.hostSelector ? document.querySelector(this.hostSelector) : null;
    }
}
