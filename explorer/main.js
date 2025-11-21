import WebSkel from './WebSkel/webskel.mjs';
import assistosSDK, { initialiseAssistOS } from './services/assistosSDK.js';
import {
    computeComponentBaseUrl,
    normalizeRuntimePlugins,
    mergeRuntimePluginsIntoAssistOS,
    fetchTextOrThrow,
    fetchOptionalText,
    registerRuntimeComponent,
    scopeCssToComponent
} from './utils/pluginUtils.js';

const EXPLORER_AGENT_ID = 'explorer';
const RUNTIME_PLUGIN_TOOL = 'collect_ide_plugins';

if (typeof window !== 'undefined') {
    window.ASSISTOS_AGENT_ID = window.ASSISTOS_AGENT_ID || EXPLORER_AGENT_ID;
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

async function fetchRuntimePlugins() {
    return await assistosSDK.fetchRuntimePlugins(EXPLORER_AGENT_ID, RUNTIME_PLUGIN_TOOL);
}

async function loadComponentFromAgent(webSkel, meta) {
    const { componentName, presenterName, agent, ownerComponent, isDependency, customPath, baseUrl } = meta;
    if (!isNonEmptyString(componentName) || !isNonEmptyString(agent)) {
        return;
    }

    const normalizedComponent = componentName.trim();
    const normalizedAgent = agent.trim();
    const componentBase = baseUrl && isNonEmptyString(baseUrl)
        ? baseUrl.trim()
        : computeComponentBaseUrl(normalizedAgent, normalizedComponent, { ownerComponent, isDependency, customPath });
    const safeBase = componentBase.replace(/\/+/g, '/');

    const [loadedTemplate, rawCss, presenterSource] = await Promise.all([
        fetchTextOrThrow(`${safeBase}.html`, `[runtime-plugins] Failed to load template for ${normalizedComponent}`),
        fetchTextOrThrow(`${safeBase}.css`, `[runtime-plugins] Failed to load stylesheet for ${normalizedComponent}`),
        isNonEmptyString(presenterName) ? fetchOptionalText(`${safeBase}.js`) : Promise.resolve('')
    ]);

    const scopedCss = scopeCssToComponent(rawCss, normalizedComponent);

    let presenterModuleInstance;
    if (isNonEmptyString(presenterName) && presenterSource.trim()) {
        try {
            presenterModuleInstance = await import(/* webpackIgnore: true */ `${safeBase}.js?cacheBust=${Date.now()}`);
        } catch (error) {
            console.error(`[runtime-plugins] Failed to import presenter for ${normalizedComponent}:`, error);
        }
    }

    const fullComponent = {
        name: normalizedComponent,
        loadedTemplate,
        loadedCSS: scopedCss,
        presenterClassName: isNonEmptyString(presenterName) ? presenterName.trim() : undefined,
        presenterModule: presenterSource,
        agent: normalizedAgent
    };

    const componentForRegistration = { ...fullComponent, loadedCSSs: [scopedCss] };
    if (presenterModuleInstance && fullComponent.presenterClassName && presenterModuleInstance[fullComponent.presenterClassName]) {
        componentForRegistration.presenterModule = presenterModuleInstance;
    }

    await registerRuntimeComponent(webSkel, componentForRegistration);
    return fullComponent;
}

async function loadRuntimePluginComponents(webSkel, runtimePlugins) {
    if (!runtimePlugins || typeof runtimePlugins !== 'object') {
        return new Map();
    }

    const scheduledComponents = new Map();
    const scheduleComponent = (meta) => {
        const componentName = meta?.componentName;
        const agent = meta?.agent;
        if (!isNonEmptyString(componentName) || !isNonEmptyString(agent)) {
            return;
        }
        const key = `${agent.trim()}::${componentName.trim()}`;
        if (!scheduledComponents.has(key)) {
            scheduledComponents.set(key, {
                componentName: componentName.trim(),
                presenterName: isNonEmptyString(meta.presenterName) ? meta.presenterName.trim() : undefined,
                agent: agent.trim(),
                ownerComponent: isNonEmptyString(meta.ownerComponent) ? meta.ownerComponent.trim() : undefined,
                isDependency: Boolean(meta.isDependency),
                customPath: isNonEmptyString(meta.customPath) ? meta.customPath.trim() : undefined,
                baseUrl: isNonEmptyString(meta.baseUrl) ? meta.baseUrl.trim() : undefined
            });
        }
    };

    for (const plugins of Object.values(runtimePlugins)) {
        if (!Array.isArray(plugins)) {
            continue;
        }
        for (const plugin of plugins) {
            if (!plugin || typeof plugin !== 'object') {
                continue;
            }
            scheduleComponent({
                componentName: plugin.component,
                presenterName: plugin.presenter,
                agent: plugin.agent,
                ownerComponent: plugin.component,
                isDependency: false,
                baseUrl: plugin.componentBaseUrl
            });

            if (Array.isArray(plugin.dependencies)) {
                for (const dependency of plugin.dependencies) {
                    if (!dependency || typeof dependency !== 'object') {
                        continue;
                    }
                    const dependencyComponent = dependency.component || dependency.name;
                    const dependencyPresenter = dependency.presenter || dependency.presenterClassName;
                    const dependencyAgent = dependency.agent || plugin.agent;
                    const dependencyPath = dependency.path || dependency.directory;
                    scheduleComponent({
                        componentName: dependencyComponent,
                        presenterName: dependencyPresenter,
                        agent: dependencyAgent,
                        ownerComponent: dependency.ownerComponent || plugin.component,
                        isDependency: true,
                        customPath: dependencyPath,
                        baseUrl: dependency.baseUrl
                    });
                }
            }
        }
    }

    const loaded = new Map();
    for (const componentMeta of scheduledComponents.values()) {
        try {
            const component = await loadComponentFromAgent(webSkel, componentMeta);
            if (component) {
                loaded.set(`${componentMeta.agent}::${componentMeta.componentName}`, component);
            }
        } catch (error) {
            console.error(`[runtime-plugins] Failed to load component ${componentMeta.componentName} from agent ${componentMeta.agent}:`, error);
        }
    }

    return loaded;
}

async function start() {
    const webSkel = await WebSkel.initialise('webskel.json');
    webSkel.appServices = assistosSDK;

    const rawRuntimePlugins = await fetchRuntimePlugins();
    const runtimePlugins = normalizeRuntimePlugins(rawRuntimePlugins);

    const assistOS = initialiseAssistOS({ ui: webSkel, runtimePlugins: Object.keys(runtimePlugins).length ? runtimePlugins : undefined });
    assistOS.webSkel = webSkel;
    assistOS.appServices = assistosSDK;
    assistOS.runtimePlugins = runtimePlugins;
    assistOS.rawRuntimePlugins = rawRuntimePlugins || {};
    mergeRuntimePluginsIntoAssistOS(assistOS, runtimePlugins);
    if (typeof window !== 'undefined') {
        window.UI = webSkel;
    }
    //TODO review this
    const originalShowModal = typeof webSkel.showModal === 'function' ? webSkel.showModal.bind(webSkel) : null;
    webSkel.showModal = async (name, payload = {}, expectResult = false) => {
        const component = webSkel.configs?.components?.find?.((item) => item.name === name);
        if (component && typeof originalShowModal === 'function') {
            return originalShowModal(name, payload, expectResult);
        }

        switch (name) {
            case 'confirm-action-modal': {
                const message = payload?.message ?? 'Are you sure?';
                const confirmed = typeof window !== 'undefined'
                    ? window.confirm(message)
                    : true;
                return expectResult ? confirmed : undefined;
            }
            case 'add-comment': {
                if (typeof window === 'undefined') {
                    return expectResult ? '' : undefined;
                }
                const result = window.prompt('Enter comment', '');
                return expectResult ? result : undefined;
            }
            default: {
                console.warn(`[assistOS] Modal "${name}" is not registered in the local configs.`);
                return expectResult ? null : undefined;
            }
        }
    };

    webSkel.setLoading(`<div class="spinner-container"><div class="spin"></div></div>`);
    webSkel.setDomElementForPages(document.querySelector("#page_content"));
    const loader = document.querySelector("#before_webskel_loader");
    loader.close(); // Close the loader
    loader.remove();

    const hash = window.location.hash;
    let pageName;
    let url;
    if(hash){
        url = hash.substring(1);
        pageName = url.split('/')[0].split('?')[0];
    } else {
        pageName = 'file-exp';
        url = 'file-exp';
    }

    const loadedRuntimeComponents = await loadRuntimePluginComponents(webSkel, runtimePlugins);
    assistOS.runtimePluginComponents = loadedRuntimeComponents;

    await webSkel.changeToDynamicPage(pageName || 'file-exp', url || 'file-exp');
    window.webSkel = webSkel;
}

start();
