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

export class VideoPlugin {
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
        this.ensureBackgroundVideoHydrated();
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.fileInput = this.element.querySelector(".file-input");
        this.resetFileInputListener();
        await this.populateExistingVideo();
    }

    resetFileInputListener() {
        this.fileInput.addEventListener("change", this.uploadBackgroundVideo.bind(this), { once: true });
    }

    uploadBackgroundVideo(event) {
        const file = event.target.files[0];
        const maxFileSize = 500 * 1024 * 1024;
        if (!file) {
            return;
        }
        if (file.size > maxFileSize) {
            return showApplicationError("The file is too large.", "Maximum file size is 500MB.", "");
        }
        const handleError = (error) => {
            console.error("Failed to upload video", error);
            assistOS.showToast("Failed to upload video.", "error");
            this.resetFileInputListener();
        };
        try {
            const uploadPromise = uploadBlobFile(file);
            const videoElement = document.createElement("video");
            const objectUrl = URL.createObjectURL(file);
            videoElement.addEventListener("loadedmetadata", async () => {
                try {
                    const uploadResult = await uploadPromise;
                    const metadata = {
                        id: uploadResult.id ?? uploadResult.filename ?? `video-${Date.now()}`,
                        loop: false,
                        start: 0,
                        end: videoElement.duration,
                        duration: videoElement.duration,
                        volume: 100,
                        path: uploadResult.downloadUrl
                    };
                    await this.persistVideoAttachment(metadata);
                    await this.populateExistingVideo();
                    this.resetFileInputListener();
                    assistOS.showToast("Video saved.", "success");
                } catch (error) {
                    handleError(error);
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            });
            videoElement.addEventListener("error", () => {
                URL.revokeObjectURL(objectUrl);
                handleError(new Error("Unable to read video metadata."));
            });
            videoElement.src = objectUrl;
        } catch (error) {
            handleError(error);
        }
        this.fileInput.value = "";
    }

    insertVideo() {
        this.fileInput.click();
    }

    async saveVideoChanges() {
        const loopInput = this.element.querySelector("#video-loop");
        const volumeInput = this.element.querySelector("#video-volume");
        const videoData = this.chapter.backgroundVideo;
        if (!videoData) {
            return;
        }
        const payload = {
            ...videoData,
            path: videoData.url || videoData.path || "",
            loop: loopInput.checked,
            volume: parseFloat(volumeInput.value)
        };
        try {
            await this.persistVideoAttachment(payload);
            await this.populateExistingVideo();
            assistOS.showToast("Video updated.", "success");
        } catch (error) {
            console.error("Failed to update video", error);
            assistOS.showToast("Failed to update video.", "error");
        }
    }

    async deleteBackgroundVideo() {
        if (!this.chapter.backgroundVideo) {
            return;
        }
        try {
            await documentModule.setChapterVideoAttachment(assistOS.space.id, this._document.id, this.chapter.id, null);
            delete this.chapter.backgroundVideo;
            await this.populateExistingVideo();
            assistOS.showToast("Video removed.", "info");
        } catch (error) {
            console.error("Failed to delete video", error);
            assistOS.showToast("Failed to delete video.", "error");
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

    async populateExistingVideo() {
        const videoData = this.getBackgroundVideoData();
        const videoConfigs = this.element.querySelector(".video-configs");
        const videoElement = this.element.querySelector(".video-plugin__player");
        const loopInput = this.element.querySelector("#video-loop");
        const volumeInput = this.element.querySelector("#video-volume");

        if (!videoData) {
            videoConfigs.classList.add("hidden");
            videoElement.classList.add("hidden");
            return;
        }

        videoConfigs.classList.remove("hidden");
        videoElement.classList.remove("hidden");
        videoElement.src = videoData.url || await spaceModule.getVideoURL(videoData.id);
        videoElement.load();
        videoElement.loop = videoData.loop;
        loopInput.checked = videoData.loop;
        const volumeValue = videoData.volume ?? 100;
        volumeInput.value = volumeValue;
        videoElement.volume = volumeValue / 100;
        volumeInput.oninput = () => {
            videoElement.volume = parseFloat(volumeInput.value || '0') / 100;
        };
    }

    getBackgroundVideoData() {
        if (this.chapter.backgroundVideo) {
            return this.chapter.backgroundVideo;
        }
        return null;
    }

    async persistVideoAttachment(payload) {
        const backgroundVideo = await documentModule.setChapterVideoAttachment(
            assistOS.space.id,
            this._document.id,
            this.chapter.id,
            payload
        );
        if (backgroundVideo) {
            this.chapter.backgroundVideo = backgroundVideo;
        } else {
            delete this.chapter.backgroundVideo;
        }
    }

    ensureBackgroundVideoHydrated() {
        // backgroundVideo is hydrated by the document module; no additional work required here
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
        return chapterElement.querySelector(".icon-container.video-plugin");
    }
}
