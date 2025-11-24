import { MEDIA_UPLOAD_ERROR_CODES, processMediaUpload, readAudioMetadata } from '../utils/mediaUpload.js';
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


export class AudioPlugin {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        const context = getContext(this.element);
        this.chapterId = context.chapterId || this.element.getAttribute("data-chapter-id");
        this.paragraphId = context.paragraphId || this.element.getAttribute("data-paragraph-id");
        this.hostSelector = context.hostSelector || "";
        const documentViewPage = document.querySelector("document-view-page");
        this.documentPresenter = documentViewPage?.webSkelPresenter ?? null;
        if (!this.documentPresenter || !this.documentPresenter._document) {
            throw new Error("Document context is required for audio plugin.");
        }
        this._document = this.documentPresenter._document;
        this.chapter = this._document.chapters.find((chapter) => chapter.id === this.chapterId);
        if (!this.chapter) {
            throw new Error(`Chapter ${this.chapterId} not found.`);
        }
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
            this.ensureBackgroundSoundHydrated();
        }
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.fileInput = this.element.querySelector(".file-input");
        this.resetFileInputListener();
        this.audioListElement = this.element.querySelector('.audio-list');
        await this.populateExistingAudio();
    }

    resetFileInputListener() {
        this.fileInput.addEventListener("change", this.uploadBackgroundSound.bind(this), { once: true });
    }

    async uploadBackgroundSound(event) {
        const file = event?.target?.files?.[0];
        try {
            const { uploadResult, metadata } = await processMediaUpload({
                file,
                maxFileSize: 100 * 1024 * 1024,
                metadataReader: readAudioMetadata
            });
            const duration = Number.isFinite(metadata?.duration) ? metadata.duration : 0;
            const payload = {
                id: uploadResult.id ?? uploadResult.filename ?? `audio-${Date.now()}`,
                volume: 50,
                duration,
                loop: false,
                start: 0,
                end: duration,
                path: uploadResult.downloadUrl,
                name: uploadResult.filename || file?.name
            };
            await this.persistAudioAttachment(payload);
            await this.invalidateCompiledVideo();
            await this.populateExistingAudio();
            assistOS.showToast("Audio saved.", "success");
        } catch (error) {
            if (error?.code === MEDIA_UPLOAD_ERROR_CODES.NO_FILE) {
                return;
            }
            if (error?.code === MEDIA_UPLOAD_ERROR_CODES.TOO_LARGE) {
                showApplicationError("The file is too large.", "Maximum file size is 100MB.", "");
                return;
            }
            console.error("Failed to upload audio", error);
            assistOS.showToast("Failed to upload audio.", "error");
        } finally {
            if (this.fileInput) {
                this.fileInput.value = "";
            }
            this.resetFileInputListener();
        }
    }

    insertAudio() {
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
        this.requestContextRerender();
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

    async populateExistingAudio() {
        await this.renderAudioList();
        this.refreshChapterPreviewIcons();
    }

    getAudioAttachments() {
        if (this.isParagraphContext) {
            if (Array.isArray(this.paragraph?.mediaAttachments?.audio) && this.paragraph.mediaAttachments.audio.length) {
                return this.paragraph.mediaAttachments.audio;
            }
            return [];
        }
        if (Array.isArray(this.chapter.mediaAttachments?.audio) && this.chapter.mediaAttachments.audio.length) {
            return this.chapter.mediaAttachments.audio;
        }
        return this.chapter.backgroundSound ? [this.chapter.backgroundSound] : [];
    }

    async renderAudioList() {
        const container = this.audioListElement;
        if (!container) {
            return;
        }
        const attachments = this.getAudioAttachments();
        if (!attachments.length) {
            container.innerHTML = '<div class="audio-empty-state">No audio tracks yet.</div>';
            return;
        }
        container.innerHTML = attachments.map((item, index) => this.renderAudioItemTemplate(item, index)).join('');
    }

    renderAudioItemTemplate(item, index) {
        const sanitize = (value) => typeof assistOS?.UI?.sanitize === 'function' ? assistOS.UI.sanitize(value) : value;
        const escapeAttr = (value) => {
            if (value === undefined || value === null) {
                return '';
            }
            return String(value).replace(/"/g, '&quot;');
        };
        const title = sanitize(item.name || item.filename || item.id || `Audio ${index + 1}`);
        const volume = Number.isFinite(item.volume) ? item.volume : 50;
        const start = Number.isFinite(item.start) ? item.start : 0;
        const endValue = Number.isFinite(item.end) ? item.end : (Number.isFinite(item.duration) ? item.duration : 0);
        const url = sanitize(item.url || item.path || '');
        const durationLabel = Number.isFinite(item.duration) ? `${item.duration.toFixed(2)}s` : '';
        const identifier = typeof item.identifier === 'string' ? item.identifier : '';
        const identifierAttr = escapeAttr(identifier);
        const saveAction = identifier ? `saveAudioItem ${identifier}` : 'saveAudioItem';
        const deleteAction = identifier ? `deleteAudioItem ${identifier}` : 'deleteAudioItem';
        const saveActionAttr = escapeAttr(saveAction);
        const deleteActionAttr = escapeAttr(deleteAction);
        return `
        <div class="audio-item" data-identifier="${identifierAttr}">
            <div class="audio-item-header">
                <span>${title}</span>
                <span>${durationLabel}</span>
            </div>
            <audio class="audio-plugin-player" controls preload="metadata" src="${url}"></audio>
            <div class="audio-item-controls">
                <label>Volume
                    <input type="number" min="0" max="100" step="1" data-field="volume" value="${volume}">
                </label>
                <label>Start (s)
                    <input type="number" min="0" step="0.1" data-field="start" value="${start}">
                </label>
                <label>End (s)
                    <input type="number" min="0" step="0.1" data-field="end" value="${endValue}">
                </label>
                <label class="audio-item-loop">Loop
                    <input type="checkbox" data-field="loop" ${item.loop ? 'checked' : ''}>
                </label>
            </div>
            <div class="audio-item-actions">
                <button class="general-button" type="button" data-local-action="${saveActionAttr}">Save</button>
                <button class="general-button danger" type="button" data-local-action="${deleteActionAttr}">Delete</button>
            </div>
        </div>`;
    }

    async saveAudioItem(triggerElement, identifier) {
        const container = triggerElement?.closest('.audio-item');
        const targetIdentifier = identifier || container?.dataset?.identifier;
        if (!container || !targetIdentifier) {
            return;
        }
        const attachments = this.getAudioAttachments();
        const current = attachments.find((attachment) => attachment.identifier === targetIdentifier);
        if (!current) {
            return;
        }
        const volumeInput = container.querySelector('[data-field="volume"]');
        const startInput = container.querySelector('[data-field="start"]');
        const endInput = container.querySelector('[data-field="end"]');
        const loopInput = container.querySelector('[data-field="loop"]');
        const payload = {
            identifier: targetIdentifier,
            id: current.id,
            path: current.url || current.path || '',
            name: current.name || current.filename,
            volume: Number.parseFloat(volumeInput?.value ?? '50'),
            start: Number.parseFloat(startInput?.value ?? '0'),
            end: Number.parseFloat(endInput?.value ?? '0'),
            loop: Boolean(loopInput?.checked)
        };
        try {
            await this.persistAudioAttachment(payload);
            await this.invalidateCompiledVideo();
            await this.populateExistingAudio();
            assistOS.showToast('Audio updated.', 'success');
        } catch (error) {
            console.error('Failed to update audio track', error);
            assistOS.showToast('Failed to update audio.', 'error');
        }
    }

    async deleteAudioItem(triggerElement, identifier) {
        const container = triggerElement?.closest('.audio-item');
        const targetIdentifier = identifier || container?.dataset?.identifier;
        if (!targetIdentifier) {
            return;
        }
        try {
            if (this.isParagraphContext) {
                await documentModule.deleteParagraphAudioAttachment(
                    this._document.id,
                    this.chapter.id,
                    this.paragraph.id,
                    targetIdentifier
                );
            } else {
                await documentModule.deleteChapterAudioAttachment(this._document.id, this.chapter.id, targetIdentifier);
            }
            await this.invalidateCompiledVideo();
            await this.populateExistingAudio();
            assistOS.showToast('Audio removed.', 'info');
        } catch (error) {
            console.error('Failed to delete audio', error);
            assistOS.showToast('Failed to delete audio.', 'error');
        }
    }

    async persistAudioAttachment(payload) {
        if (this.isParagraphContext) {
            return documentModule.setParagraphAudioAttachment(
                this._document.id,
                this.chapter.id,
                this.paragraph.id,
                payload
            );
        }
        return documentModule.setChapterAudioAttachment(
            this._document.id,
            this.chapter.id,
            payload
        );
    }

    ensureBackgroundSoundHydrated() {
        this.chapter.mediaAttachments = this.chapter.mediaAttachments || {};
        if (!Array.isArray(this.chapter.mediaAttachments.audio)) {
            this.chapter.mediaAttachments.audio = [];
        }
    }

    getHostPresenter() {
        const hostElement = this.getHostElement();
        return hostElement?.webSkelPresenter || null;
    }

    getPluginIconElement() {
        const hostElement = this.getHostElement();
        if (!hostElement) {
            return null;
        }
        return hostElement.querySelector(`.icon-container.${this.element.tagName.toLowerCase()}`);
    }

    refreshChapterPreviewIcons() {
        const presenter = this.getHostPresenter();
        presenter?.renderInfoIcons?.();
    }

    requestContextRerender() {
        const presenter = this.getHostPresenter();
        if (presenter?.invalidate) {
            presenter.invalidate();
        } else if (this.documentPresenter?.invalidate) {
            this.documentPresenter.invalidate();
        }
    }

    getHostElement() {
        return this.hostSelector ? document.querySelector(this.hostSelector) : null;
    }
}
