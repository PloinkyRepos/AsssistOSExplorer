function getContext(element) {
    const rawContext = element.getAttribute("data-context") || "{}";
    try {
        return JSON.parse(decodeURIComponent(rawContext));
    } catch {
        return {};
    }
}

function resolveIcon(iconPath) {
    if (!iconPath) {
        return "";
    }
    if (iconPath.startsWith("http") || iconPath.startsWith("data:") || iconPath.startsWith("/")) {
        return iconPath;
    }
    try {
        return new URL(iconPath, import.meta.url).href;
    } catch {
        return iconPath;
    }
}

export class SimpleStateIcon{
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        let context = getContext(this.element);
        this.plugin = context.plugin;
        this.type = context.type;
        this.iconURL = resolveIcon(context.icon);
        let paragraphItem = this.element.closest("paragraph-item");
        if (paragraphItem && paragraphItem.webSkelPresenter) {
            this.paragraph = paragraphItem.webSkelPresenter.paragraph;
            this.paragraphPresenter = paragraphItem.webSkelPresenter;
        }
        this.invalidate();
    }
    pluginMap = {
        "image-creator": "image",
        "audio-creator": "audio",
        "video-creator": "video",
    }
    beforeRender(){}
    afterRender(){
        if(!this.paragraphPresenter || !this.paragraph){
            return;
        }
        if(this.pluginMap[this.plugin] && this.paragraph.commands[this.pluginMap[this.plugin]]){
            this.highlightIcon();
        } else {
            this.removeHighlight();
        }
    }

    highlightIcon(){
        let pluginContainer = this.element.closest(".plugin-circle");
        if(pluginContainer){
            pluginContainer.classList.add("highlight-attachment");
        }
        this.highlightPreviewIcon();
    }
    removeHighlight(){
        let pluginContainer = this.element.closest(".plugin-circle");
        if(pluginContainer){
            pluginContainer.classList.remove("highlight-attachment");
        }
        this.removeHighlightPreviewIcon();
    }
    highlightPreviewIcon(){
        if(!this.paragraphPresenter){
            return;
        }
        let iconsContainer = this.paragraphPresenter.element.querySelector(".preview-icons");
        if(!iconsContainer){
            return;
        }
        let attachmentType = this.pluginMap[this.plugin];
        let attachmentIcon = iconsContainer.querySelector(`.preview-icon.has-${attachmentType}-icon`);
        if(!attachmentIcon){
            let iconHTML = `<img src="${this.iconURL}" alt="${attachmentType}" class="preview-icon has-${attachmentType}-icon">`;
            iconsContainer.insertAdjacentHTML("afterbegin", iconHTML);
        }
    }
    removeHighlightPreviewIcon(){
        if(!this.paragraphPresenter){
            return;
        }
        let iconsContainer = this.paragraphPresenter.element.querySelector(".preview-icons");
        if(!iconsContainer){
            return;
        }
        let attachmentType = this.pluginMap[this.plugin];
        let attachmentIcon = iconsContainer.querySelector(`.preview-icon.has-${attachmentType}-icon`);
        if(attachmentIcon){
            attachmentIcon.remove();
        }
    }
}
