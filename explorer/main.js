import WebSkel from './WebSkel/webskel.mjs';
import assistosSDK, { initialiseAssistOS } from './services/assistosSDK.js';
import { createComponentRegistry } from './services/runtime/componentRegistry.js';
import { createRuntimePluginLoader } from './services/runtime/runtimePluginLoader.js';
import { attachUiFallbacks } from './services/runtime/uiFallbacks.js';

const EXPLORER_AGENT_ID = 'explorer';
const RUNTIME_PLUGIN_TOOL = 'collect_ide_plugins';

if (typeof window !== 'undefined') {
    window.ASSISTOS_AGENT_ID = window.ASSISTOS_AGENT_ID || EXPLORER_AGENT_ID;
}

const hasRuntimePlugins = (runtimePlugins) => {
    if (!runtimePlugins) {
        return false;
    }
    return Object.values(runtimePlugins).some((entries) => Array.isArray(entries) && entries.length > 0);
};

async function start() {
    const webSkel = await WebSkel.initialise('webskel.json');
    webSkel.appServices = assistosSDK;

    const componentRegistry = createComponentRegistry(webSkel);
    const runtimePluginLoader = createRuntimePluginLoader({
        agentId: EXPLORER_AGENT_ID,
        runtimePluginTool: RUNTIME_PLUGIN_TOOL,
        assistosSDK,
        componentRegistry
    });

    const { raw: rawRuntimePlugins, normalized: runtimePlugins } = await runtimePluginLoader.fetchRuntimePlugins();
    const assistOS = initialiseAssistOS({
        ui: webSkel,
        runtimePlugins: hasRuntimePlugins(runtimePlugins) ? runtimePlugins : undefined
    });
    assistOS.webSkel = webSkel;
    assistOS.appServices = assistosSDK;
    assistOS.runtimePlugins = runtimePlugins;
    assistOS.rawRuntimePlugins = rawRuntimePlugins || {};
    runtimePluginLoader.mergeIntoAssistOS(assistOS, runtimePlugins);

    if (typeof window !== 'undefined') {
        window.UI = webSkel;
    }

    attachUiFallbacks(webSkel);

    webSkel.setLoading(`<div class="spinner-container"><div class="spin"></div></div>`);
    webSkel.setDomElementForPages(document.querySelector("#page_content"));
    const loader = document.querySelector("#before_webskel_loader");
    loader.close();
    loader.remove();

    const hash = window.location.hash;
    let pageName;
    let url;
    if (hash) {
        url = hash.substring(1);
        pageName = url.split('/')[0].split('?')[0];
    } else {
        pageName = 'file-exp';
        url = 'file-exp';
    }

    const loadedRuntimeComponents = await runtimePluginLoader.loadComponents(runtimePlugins);
    assistOS.runtimePluginComponents = loadedRuntimeComponents;

    await webSkel.changeToDynamicPage(pageName || 'file-exp', url || 'file-exp');
    window.webSkel = webSkel;
}

start().catch((error) => {
    console.error('[explorer] Failed to bootstrap application', error);
});
