import { uploadBlobFile } from '../utils/blobUpload.js';
const spaceModule = assistOS.loadModule("space");
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
        this._document = documentViewPage.webSkelPresenter._document;
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
                        path: uploadResult.downloadUrl
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

    async saveBackgroundSoundChanges() {
        const loopInput = this.element.querySelector("#loop");
        const volumeInput = this.element.querySelector("#volume");
        const audioData = this.chapter.backgroundSound;
        if (!audioData) {
            return;
        }
        const payload = {
            ...audioData,
            path: audioData.url || audioData.path || "",
            loop: loopInput.checked,
            volume: parseFloat(volumeInput.value)
        };
        try {
            await this.persistAudioAttachment(payload);
            await this.invalidateCompiledVideo();
            await this.populateExistingAudio();
            assistOS.showToast("Audio updated.", "success");
        } catch (error) {
            console.error("Failed to update audio", error);
            assistOS.showToast("Failed to update audio.", "error");
        }
    }

    async deleteBackgroundSound() {
        if (!this.chapter.backgroundSound) {
            return;
        }
        try {
            await documentModule.setChapterAudioAttachment(assistOS.space.id, this._document.id, this.chapter.id, null);
            delete this.chapter.backgroundSound;
            await this.invalidateCompiledVideo();
            await this.populateExistingAudio();
            assistOS.showToast("Audio removed.", "info");
        } catch (error) {
            console.error("Failed to delete audio", error);
            assistOS.showToast("Failed to delete audio.", "error");
        }
    }

    async closeModal() {
        const chapterPresenter = this.getChapterPresenter();
        if (chapterPresenter) {
            await chapterPresenter.closePlugin("", false);
        } else {
            this.resetPluginButtonState();
        }
        assistOS.UI.closeModal(this.element);
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
        const audioData = this.getBackgroundSoundData();
        const audioConfigs = this.element.querySelector(".audio-configs");
        const audioElement = this.element.querySelector(".audio-plugin-player");
        const loopInput = this.element.querySelector("#loop");
        const volumeInput = this.element.querySelector("#volume");

        if (!audioData) {
            audioConfigs.classList.add("hidden");
            audioElement.classList.add("hidden");
            return;
        }

        audioConfigs.classList.remove("hidden");
        audioElement.classList.remove("hidden");
        audioElement.src = audioData.url || await spaceModule.getAudioURL(audioData.id);
        audioElement.load();
        audioElement.volume = audioData.volume / 100;
        audioElement.loop = audioData.loop;
        loopInput.checked = audioData.loop;
        volumeInput.value = audioData.volume ?? 50;
        volumeInput.oninput = () => {
            audioElement.volume = parseFloat(volumeInput.value) / 100;
        };
    }

    getBackgroundSoundData() {
        if (this.chapter.backgroundSound) {
            return this.chapter.backgroundSound;
        }
        const legacyVariable = this.getLegacyAudioVariable();
        const fallbackSound = this.buildBackgroundSoundFromVariable(legacyVariable);
        if (fallbackSound) {
            this.chapter.backgroundSound = fallbackSound;
            return fallbackSound;
        }
        delete this.chapter.backgroundSound;
        return null;
    }

    getLegacyAudioVariable() {
        if (!Array.isArray(this.chapter.variables)) {
            this.chapter.variables = [];
        }
        return this.chapter.variables.find((variable) => variable.name === "audio-attachment");
    }

    buildBackgroundSoundFromVariable(variable) {
        if (!variable || !variable.options || !variable.options.id) {
            return null;
        }
        const options = variable.options;
        return {
            id: options.id,
            url: typeof variable.value === "string" ? variable.value : "",
            volume: typeof options.volume === "number" ? options.volume : 50,
            loop: Boolean(options.loop),
            duration: typeof options.duration === "number" ? options.duration : 0,
            start: typeof options.start === "number" ? options.start : 0,
            end: typeof options.end === "number" ? options.end : (typeof options.duration === "number" ? options.duration : 0)
        };
    }

    async persistAudioAttachment(payload) {
        const backgroundSound = await documentModule.setChapterAudioAttachment(
            assistOS.space.id,
            this._document.id,
            this.chapter.id,
            payload
        );
        if (backgroundSound) {
            this.chapter.backgroundSound = backgroundSound;
        } else {
            delete this.chapter.backgroundSound;
        }
    }

    ensureBackgroundSoundHydrated() {
        if (this.chapter.backgroundSound) {
            return;
        }
        const legacyVariable = this.getLegacyAudioVariable();
        const fallbackSound = this.buildBackgroundSoundFromVariable(legacyVariable);
        if (fallbackSound) {
            this.chapter.backgroundSound = fallbackSound;
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
}
