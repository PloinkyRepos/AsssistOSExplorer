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

export class ChapterAudio {
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
        this.chapter.backgroundSound = this.buildBackgroundSoundFromVariable(this.getAudioVariable());
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
        const reader = new FileReader();
        reader.onload = async (e) => {
            const uint8Array = new Uint8Array(e.target.result);
            const audioId = await spaceModule.putAudio(uint8Array);
            const audioPlayer = new Audio();
            audioPlayer.addEventListener("loadedmetadata", async () => {
                const metadata = {
                    id: audioId,
                    volume: 50,
                    duration: audioPlayer.duration,
                    loop: false,
                    start: 0,
                    end: audioPlayer.duration
                };
                const audioUrl = await spaceModule.getAudioURL(audioId);
                await this.persistAudioVariable(audioUrl, metadata);
                await this.invalidateCompiledVideo();
                await this.populateExistingAudio();
                this.resetFileInputListener();
                assistOS.showToast("Chapter audio saved.", "success");
            });
            audioPlayer.src = URL.createObjectURL(file);
        };
        reader.readAsArrayBuffer(file);
        this.fileInput.value = "";
    }

    insertAudio() {
        this.fileInput.click();
    }

    async saveBackgroundSoundChanges() {
        const loopInput = this.element.querySelector("#loop");
        const volumeInput = this.element.querySelector("#volume");
        const audioVar = this.getAudioVariable();
        if (!audioVar || !audioVar.options) {
            return;
        }
        const metadata = {
            ...audioVar.options,
            loop: loopInput.checked,
            volume: parseFloat(volumeInput.value)
        };
        await this.persistAudioVariable(audioVar.value, metadata);
        await this.invalidateCompiledVideo();
        await this.populateExistingAudio();
        assistOS.showToast("Chapter audio updated.", "success");
    }

    async deleteBackgroundSound() {
        const audioVar = this.getAudioVariable();
        if (!audioVar) {
            return;
        }
        await documentModule.setChapterVarValue(assistOS.space.id, this._document.id, this.chapter.id, "audio-attachment", "", null);
        this.chapter.variables = this.chapter.variables.filter((variable) => variable.name !== "audio-attachment");
        delete this.chapter.backgroundSound;
        await this.invalidateCompiledVideo();
        await this.populateExistingAudio();
        assistOS.showToast("Chapter audio removed.", "info");
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
        const audioElement = this.element.querySelector(".chapter-audio");
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
        const variable = this.getAudioVariable();
        const backgroundSound = this.buildBackgroundSoundFromVariable(variable);
        if (backgroundSound) {
            this.chapter.backgroundSound = backgroundSound;
        } else {
            delete this.chapter.backgroundSound;
        }
        return backgroundSound;
    }

    getAudioVariable() {
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

    async persistAudioVariable(url, metadata) {
        const variable = await documentModule.setChapterVarValue(
            assistOS.space.id,
            this._document.id,
            this.chapter.id,
            "audio-attachment",
            url,
            metadata
        );
        this.updateLocalAudioVariable(variable);
        this.chapter.backgroundSound = this.buildBackgroundSoundFromVariable(variable);
    }

    updateLocalAudioVariable(variable) {
        if (!Array.isArray(this.chapter.variables)) {
            this.chapter.variables = [];
        }
        const index = this.chapter.variables.findIndex((item) => item.name === variable.name);
        if (index === -1) {
            this.chapter.variables.push(variable);
        } else {
            this.chapter.variables[index] = variable;
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
        return chapterElement.querySelector(".icon-container.chapter-audio");
    }
}
