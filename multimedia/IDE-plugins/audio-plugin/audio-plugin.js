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

export class AudioPlugin {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        const context = getContext(this.element);
        this.chapterId = context.chapterId || this.element.getAttribute("data-chapter-id");
        const documentViewPage = document.querySelector("document-view-page");
        this.documentPresenter = documentViewPage?.webSkelPresenter ?? null;
        if (!this.documentPresenter || !this.documentPresenter._document) {
            throw new Error("Document context is required for audio plugin.");
        }
        this._document = this.documentPresenter._document;
        this.chapter = this._document.chapters.find((chapter) => chapter.id === this.chapterId);
        if (!Array.isArray(this.chapter.variables)) {
            this.chapter.variables = [];
        }
        this.ensureBackgroundSoundHydrated();
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

    uploadBackgroundSound(event) {
        const file = event.target.files[0];
        const maxFileSize = 100 * 1024 * 1024;
        if (!file) {
            return;
        }
        if (file.size > maxFileSize) {
            return showApplicationError("The file is too large.", "Maximum file size is 100MB.", "");
        }
        const handleError = (error) => {
            console.error("Failed to upload audio", error);
            assistOS.showToast("Failed to upload audio.", "error");
            this.resetFileInputListener();
        };
        try {
            const uploadPromise = uploadBlobFile(file);
            const audioPlayer = new Audio();
            const objectUrl = URL.createObjectURL(file);
            audioPlayer.addEventListener("loadedmetadata", async () => {
                try {
                    const uploadResult = await uploadPromise;
                    const metadata = {
                        id: uploadResult.id ?? uploadResult.filename ?? `audio-${Date.now()}`,
                        volume: 50,
                        duration: audioPlayer.duration,
                        loop: false,
                        start: 0,
                        end: audioPlayer.duration,
                        path: uploadResult.downloadUrl,
                        name: uploadResult.filename || file.name
                    };
                    await this.persistAudioAttachment(metadata);
                    await this.invalidateCompiledVideo();
                    await this.populateExistingAudio();
                    this.resetFileInputListener();
                    assistOS.showToast("Audio saved.", "success");
                } catch (error) {
                    handleError(error);
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            });
            audioPlayer.addEventListener("error", () => {
                URL.revokeObjectURL(objectUrl);
                handleError(new Error("Unable to read audio metadata."));
            });
            audioPlayer.src = objectUrl;
        } catch (error) {
            handleError(error);
        }
        this.fileInput.value = "";
    }

    insertAudio() {
        this.fileInput.click();
    }

    async closeModal() {
        const chapterPresenter = this.getChapterPresenter();
        if (chapterPresenter) {
            await chapterPresenter.closePlugin("", false);
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
        if (this.chapter.commands.compileVideo) {
            delete this.chapter.commands.compileVideo;
            await documentModule.updateChapterCommands(assistOS.space.id, this._document.id, this.chapter.id, this.chapter.commands);
        }
    }

    async populateExistingAudio() {
        await this.renderAudioList();
        this.refreshChapterPreviewIcons();
    }

    getAudioAttachments() {
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
            await documentModule.deleteChapterAudioAttachment(assistOS.space.id, this._document.id, this.chapter.id, targetIdentifier);
            await this.invalidateCompiledVideo();
            await this.populateExistingAudio();
            assistOS.showToast('Audio removed.', 'info');
        } catch (error) {
            console.error('Failed to delete audio', error);
            assistOS.showToast('Failed to delete audio.', 'error');
        }
    }

    async persistAudioAttachment(payload) {
        const attachment = await documentModule.setChapterAudioAttachment(
            assistOS.space.id,
            this._document.id,
            this.chapter.id,
            payload
        );
        if (attachment) {
            this.chapter.backgroundSound = attachment;
        } else {
            delete this.chapter.backgroundSound;
        }
    }

    ensureBackgroundSoundHydrated() {
        this.chapter.mediaAttachments = this.chapter.mediaAttachments || {};
        if (!Array.isArray(this.chapter.mediaAttachments.audio)) {
            this.chapter.mediaAttachments.audio = [];
        }
    }

    getChapterPresenter() {
        const chapterElement = document.querySelector(`chapter-item[data-chapter-id="${this.chapterId}"]`);
        return chapterElement ? chapterElement.webSkelPresenter : null;
    }

    getPluginIconElement() {
        const chapterElement = document.querySelector(`chapter-item[data-chapter-id="${this.chapterId}"]`);
        if (!chapterElement) {
            return null;
        }
        return chapterElement.querySelector(".icon-container.audio-plugin");
    }

    refreshChapterPreviewIcons() {
        const chapterPresenter = this.getChapterPresenter();
        if (chapterPresenter?.renderInfoIcons) {
            chapterPresenter.renderInfoIcons();
        }
    }

    requestChapterRerender() {
        const chapterPresenter = this.getChapterPresenter();
        if (chapterPresenter?.invalidate) {
            chapterPresenter.invalidate();
        } else if (this.documentPresenter?.invalidate) {
            this.documentPresenter.invalidate();
        }
    }
}
