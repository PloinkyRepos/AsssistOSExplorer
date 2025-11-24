export async function initialiseApplication(appName)  {
    const applicationModule = assistOS.loadModule("application");
    assistOS.initialisedApplications[appName] = await applicationModule.getApplicationManifest(appName);
}
export async function getApplicationComponent(appId, appComponentsDirPath, component) {
    const applicationModule = assistOS.loadModule("application");
    const HTMLPath = `${appComponentsDirPath}/${component.name}/${component.name}.html`
    const CSSPath = `${appComponentsDirPath}/${component.name}/${component.name}.css`
    let loadedTemplate = await applicationModule.getApplicationFile(HTMLPath);
    let loadedCSSs = await applicationModule.getApplicationFile(CSSPath);
    let presenterModule = "";
    if (component.presenterClassName) {
        const PresenterPath = `${appComponentsDirPath}/${component.name}/${component.name}.js`
        presenterModule = await applicationModule.getApplicationFile(PresenterPath);
    }
    loadedCSSs = [loadedCSSs];
    return {loadedTemplate, loadedCSSs, presenterModule};
}
export async function navigateToLocation(appName, locationArray = []) {
    let app = assistOS.initialisedApplications[appName];
    let entryPoint = app.entryPoint;
    if(app.systemApp){
        if (locationArray.length === 0 || locationArray[0] === entryPoint) {
            await assistOS.UI.changeToDynamicPage(entryPoint, `${appName}/${entryPoint}`);
            return;
        }
        const webComponentName = locationArray[0];
        await assistOS.UI.changeToDynamicPage(webComponentName, `${appName}/${locationArray.join("/")}`);
    } else {
        if (locationArray.length === 0 || locationArray[0] === entryPoint) {
            await assistOS.UI.changeToDynamicPage(entryPoint, `${appName}`);
            return;
        }
        await assistOS.UI.changeToDynamicPage(entryPoint, `${appName}/${locationArray.join("/")}`);
    }

}
