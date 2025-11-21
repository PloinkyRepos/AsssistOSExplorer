export class ShowErrorModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.invalidate();
    }

    beforeRender() {}

    closeModal(target) {
        assistOS.UI.closeModal(target);
    }

    async toggleDetails(target) {
        const details = this.element.querySelector("#detailed-error-message");
        if (details) {
            details.style.display = "block";
        }
        target.style.display = "none";
    }
}
