import { getContextualElement } from "../utils/pluginUtils.js";
const documentModule = assistOS.loadModule("document");

export class FFMpegImageToVideo {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;

        const { document, chapter, paragraph } = getContextualElement(element);
        this.document = document;
        this.chapter = chapter;
        this.paragraph = paragraph;

        this.state = {
            availableAttachments: { image: [], audio: [], video: [] },
            selectedAttachments: { image: new Set(), audio: new Set(), video: new Set() },
            params: { duration: 5, fps: 30, width: 1280, height: 720, bg: "black" },
            varName: null
        };

        this.loadAttachments();
        this.parseExistingCommands();
        this.invalidate();
    }
    beforeRender() {}

    getIdentifier(attachment) {
        return attachment.id || attachment.name || attachment.identifier;
    }

    loadAttachments() {
        const host = this.paragraph || this.chapter;
        const media = host?.mediaAttachments || {};
        this.state.availableAttachments.image = (Array.isArray(media.image) ? media.image : []).filter((att) => this.getIdentifier(att));
        this.state.availableAttachments.audio = (Array.isArray(media.audio) ? media.audio : []).filter((att) => this.getIdentifier(att));
        this.state.availableAttachments.video = (Array.isArray(media.video) ? media.video : []).filter((att) => this.getIdentifier(att));

        // Default selection: select all available attachments unless a command already exists
        if (!this.state.varName) {
            this.state.availableAttachments.image.forEach(att => this.state.selectedAttachments.image.add(this.getIdentifier(att)));
            this.state.availableAttachments.audio.forEach(att => this.state.selectedAttachments.audio.add(this.getIdentifier(att)));
            this.state.availableAttachments.video.forEach(att => this.state.selectedAttachments.video.add(this.getIdentifier(att)));
        }
    }

    afterRender() {
        this.renderAttachments("image");
        this.renderAttachments("audio");
        this.renderAttachments("video");

        this.element.querySelector('[data-local-action="saveCommand"]').addEventListener("click", this.saveCommand.bind(this));

        this.durationInput = this.element.querySelector('[data-field="duration"]');
        this.fpsInput = this.element.querySelector('[data-field="fps"]');
        this.widthInput = this.element.querySelector('[data-field="width"]');
        this.heightInput = this.element.querySelector('[data-field="height"]');
        this.bgInput = this.element.querySelector('[data-field="bg"]');
        this.applyInitialParams();
    }

    renderAttachments(type) {
        const container = this.element.querySelector(`[data-attachment-type="${type}"]`);
        const attachments = this.state.availableAttachments[type];
        const selected = this.state.selectedAttachments[type];

        if (attachments.length === 0) {
            container.innerHTML = `<div class="ffmpeg-no-attachments">No ${type} attachments found.</div>`;
            return;
        }

        const itemsHtml = attachments.map(att => {
            const identifier = this.getIdentifier(att);
            const label = att.name || identifier;
            return `
            <div class="ffmpeg-attachment-item">
                <label>
                    <input type="checkbox" data-type="${type}" data-id="${identifier}" data-name="${label}" ${selected.has(identifier) ? "checked" : ""}>
                    ${label}
                </label>
            </div>`;
        }).join("");

        container.innerHTML = itemsHtml;

        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener("change", (event) => {
                const { type, id } = event.target.dataset;
                if (!type || !id) return;
                if (event.target.checked) {
                    this.state.selectedAttachments[type].add(id);
                } else {
                    this.state.selectedAttachments[type].delete(id);
                }
            });
        });
    }

    applyInitialParams() {
        const params = this.state.params || {};
        if (this.durationInput) this.durationInput.value = params.duration ?? "";
        if (this.fpsInput) this.fpsInput.value = params.fps ?? "";
        if (this.widthInput) this.widthInput.value = params.width ?? "";
        if (this.heightInput) this.heightInput.value = params.height ?? "";
        if (this.bgInput) this.bgInput.value = params.bg ?? "";
    }

    getCurrentCommands() {
        const host = this.paragraph || this.chapter;
        return host?.commands || "";
    }

    async saveCommand(button) {
        const varName = this.state.varName || `ffmpeg_media_${Math.random().toString(36).substring(2, 9)}`;
        this.state.varName = varName;

        const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
        const byIdentifier = (type) => {
            const all = this.state.availableAttachments[type] || [];
            const map = new Map();
            all.forEach((att) => {
                const key = this.getIdentifier(att);
                if (key) map.set(key, att);
            });
            return map;
        };

        const buildPart = (commandLabel, stateKey) => {
            const selectedNames = Array.from(this.state.selectedAttachments[stateKey]);
            if (selectedNames.length === 0) return "";
            const attachmentsById = byIdentifier(stateKey);
            const ids = selectedNames
                .map((name) => attachmentsById.get(name))
                .filter(Boolean)
                .map((att) => att.id)
                .filter(Boolean);
            if (!ids.length) return "";
            return `${commandLabel} [createJsonArray ${ids.map(quote).join(" ")}]`;
        };

        const imagePart = buildPart("images", "image");
        const audioPart = buildPart("audios", "audio");
        const videoPart = buildPart("videos", "video");

        const params = this.buildStateFromInputs();
        const paramParts = Object.entries(params)
            .filter(([, value]) => value !== undefined && value !== "")
            .map(([key, value]) => `${key} ${value}`)
            .join(" ");

        const commandParts = [imagePart, audioPart, videoPart, paramParts].filter(Boolean);
        
        let commandLine = "";
        if (commandParts.length > 0) {
            commandLine = `@${varName} ffmpegImageToVideo ${commandParts.join(" ")}`.trim();
        }

        let currentCommands = this.getCurrentCommands();
        const lines = String(currentCommands).split("\n").map(l => l.trim()).filter(Boolean);
        const filteredLines = lines.filter(line => !line.startsWith("@ffmpeg_media_"));
        
        if (commandLine) {
            filteredLines.push(commandLine);
        }
        
        const updatedCommands = filteredLines.join("\n");

        try {
            await assistOS.loadifyComponent(button, async () => {
                if (this.paragraph) {
                    await documentModule.updateParagraphCommands(this.chapter.id, this.paragraph.id, updatedCommands);
                } else {
                    await documentModule.updateChapterCommands(this.document.id, this.chapter.id, updatedCommands);
                }
                assistOS.showToast("Command saved.", "success");
                this.closeModal();
            });
        } catch (error) {
            console.error("Failed to save command", error);
            assistOS.showToast("Save failed", "error");
        }
    }

    buildStateFromInputs() {
        const getVal = (input) => input?.value?.trim() || "";
        const numVal = (input) => {
            const n = Number(getVal(input));
            return Number.isFinite(n) ? n : undefined;
        };
        return {
            duration: numVal(this.durationInput),
            fps: numVal(this.fpsInput),
            width: numVal(this.widthInput),
            height: numVal(this.heightInput),
            bg: getVal(this.bgInput)
        };
    }

    parseExistingCommands() {
        const commands = this.getCurrentCommands();
        const line = String(commands).split("\n").find(l => l.trim().includes("ffmpegImageToVideo"));
        if (!line) return;

        const varMatch = line.match(/^@(\S+)/);
        if (varMatch) {
            this.state.varName = varMatch[1];
        }

        const byIdentifier = (type) => {
            const all = this.state.availableAttachments[type] || [];
            const map = new Map();
            all.forEach((att) => {
                const key = this.getIdentifier(att);
                if (key) map.set(key, att);
            });
            return map;
        };

        const extractVars = (commandLabel, stateKey) => {
            const regex = new RegExp(`${commandLabel}\\s+\\[createJsonArray\\s+([^\\]]+)\\]`);
            const match = line.match(regex);
            if (!match) return;
            const tokens = match[1].match(/"([^"]+)"|\\S+/g) || [];
            const ids = tokens
                .map(t => t.replace(/^"/, "").replace(/"$/, "").replace(/\\\"/g, '"').trim())
                .filter(Boolean);

            if (!ids.length) return;
            const attachmentsById = byIdentifier(stateKey);
            ids.forEach((id) => {
                if (attachmentsById.has(id)) {
                    this.state.selectedAttachments[stateKey].add(id);
                }
            });
        };

        // Clear default selections before parsing if a command exists
        if (this.state.varName) {
            this.state.selectedAttachments.image.clear();
            this.state.selectedAttachments.audio.clear();
            this.state.selectedAttachments.video.clear();
        }

        extractVars("images", "image");
        extractVars("audios", "audio");
        extractVars("videos", "video");

        const numberRe = /\b(duration|fps|width|height)\s+([^\s]+)/g;
        for (const match of line.matchAll(numberRe)) {
            const key = match[1];
            const val = Number(match[2]);
            if (Number.isFinite(val)) this.state.params[key] = val;
        }
        const bgMatch = line.match(/\bbg\s+("([^"]*)"|(\S+))/);
        if (bgMatch) {
            this.state.params.bg = (bgMatch[2] || bgMatch[3] || "").replace(/\\"/g, '"');
        }
    }

    closeModal() {
        assistOS.UI.closeModal(this.element);
    }
}
