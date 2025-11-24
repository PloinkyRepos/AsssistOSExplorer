const workspaceModule = assistOS.loadModule("workspace");

function getContext(element) {
    const rawContext = element.getAttribute("data-context") || "{}";
    try {
        return JSON.parse(decodeURIComponent(rawContext));
    } catch {
        return {};
    }
}
export class ImageCreator{
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        let documentPage = document.querySelector("document-view-page");
        if(!documentPage){
            return showApplicationError("Application not done yet", "use this as plugin in paragraph");
        }
        let documentPresenter = documentPage.webSkelPresenter;
        let context = getContext(this.element);
        this.paragraphId = context.paragraphId;
        this.paragraphPresenter = documentPresenter.element.querySelector(`paragraph-item[data-paragraph-id="${this.paragraphId}"]`).webSkelPresenter;
        this.commandsEditor = this.paragraphPresenter.commandsEditor;
        this.element.classList.add("maintain-focus");
        let pluginIconContainer = this.paragraphPresenter.element.querySelector(".plugin-circle.image-creator");
        let pluginIcon = pluginIconContainer.querySelector("simple-state-icon");
        this.iconPresenter = pluginIcon.webSkelPresenter;
        this.invalidate();
    }
    async beforeRender(){
        if(this.paragraphPresenter.paragraph.commands.image){
            this.imageSrc = await workspaceModule.getImageURL(this.paragraphPresenter.paragraph.commands.image.id);
        }
    }
    async afterRender(){
        let deleteImgButton = this.element.querySelector(".delete-image");
        let paragraphImage = this.element.querySelector(".paragraph-image");
        if(this.paragraphPresenter.paragraph.commands.image){
            deleteImgButton.classList.remove("hidden");
            paragraphImage.classList.remove("hidden");
        }
    }
    async insertImage(){
        let imageId = await this.commandsEditor.insertAttachmentCommand("image");
        if(imageId){
            this.changeIconState("on");
            this.iconPresenter.highlightIcon();
            this.invalidate();
        }
    }
    async deleteImage() {
        await this.commandsEditor.deleteCommand("image");
        this.changeIconState("off");
        this.iconPresenter.removeHighlight();
        this.invalidate();
    }
    changeIconState(state){
        let pluginIcon = this.paragraphPresenter.element.querySelector(".plugin-circle.image-creator");
        if(state === "on"){
            pluginIcon.classList.add("highlight-attachment");
        }else {
            pluginIcon.classList.remove("highlight-attachment");
        }
    }
}
