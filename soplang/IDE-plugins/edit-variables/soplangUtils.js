export function decodePercentCustom(encodedStr) {
    if (typeof encodedStr !== 'string') return '';
    return encodedStr.replace(/%([0-9A-Fa-f]{2})/g, (match, hexDigits) => {
        const charCode = parseInt(hexDigits, 16);
        return String.fromCharCode(charCode);
    });
}

export function getContext(presenterElement) {
    return JSON.parse(decodeURIComponent(presenterElement.getAttribute("data-context")));
}
export function renderPluginDefaultOptions(pluginElement){
    let defaultOptions = `
            <div class="options-container">
                <svg class="pointer pin" data-local-action="pinPlugin" width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
                    <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
                    <g id="SVGRepo_iconCarrier">
                        <path d="M11.9999 17V21M6.9999 12.6667V6C6.9999 4.89543 7.89533 4 8.9999 4H14.9999C16.1045 4 16.9999 4.89543 16.9999 6V12.6667L18.9135 15.4308C19.3727 16.094 18.898 17 18.0913 17H5.90847C5.1018 17 4.62711 16.094 5.08627 15.4308L6.9999 12.6667Z" stroke="#646464" stroke-width="2" stroke-linecap="round"></path>
                    </g>
                </svg>
                <img class="close-plugin pointer" data-local-action="closePlugin ${pluginElement.getAttribute("data-type")}" src="./assets/icons/x-mark.svg" alt="close">
            </div>`
    pluginElement.querySelector(".default-options").insertAdjacentHTML("afterbegin", defaultOptions);
}
export function pinPlugin(pin, pluginElement){
    let path = pin.querySelector('path');
    path.setAttribute("fill", "#646464");
    pluginElement.classList.add("pinned");
}
export function unpinPlugin(pin, pluginElement){
    let path = pin.querySelector('path');
    path.setAttribute("fill", "");
    pluginElement.classList.remove("pinned");
}
export function isEditableValue(varName, variables) {
    let docVariable = variables.find(docVariable => docVariable.varName === varName);
    if (docVariable) {
        if (docVariable.command === ":=") {
            const regex = /(?:^|[^"'`])\$(?:[a-zA-Z_$][\w$]*)/;
            const hasUnquotedVar = regex.test(docVariable.expression);
            if (hasUnquotedVar) {
                return false;
            }
            return true;
        } else if (docVariable.command === "new") {
            if (docVariable.customType === "Table" && typeof docVariable.value === "object") {
                return true;
            }
        }
    }
    return false;
}
