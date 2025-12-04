import {
    computeComponentBaseUrl,
    fetchOptionalText,
    fetchTextOrThrow,
    registerRuntimeComponent,
    scopeCssToComponent
} from '../../utils/pluginUtils.js';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

export function createComponentRegistry(webSkel) {
    if (!webSkel) {
        throw new Error('[runtime] component registry requires a WebSkel instance.');
    }

    const componentCache = new Map();

    const getCacheKey = (meta) => {
        const agent = meta?.agent;
        const componentName = meta?.componentName;
        if (!isNonEmptyString(agent) || !isNonEmptyString(componentName)) {
            return null;
        }
        return `${agent.trim()}::${componentName.trim()}`;
    };

    const resolveBaseUrl = (meta) => {
        if (isNonEmptyString(meta?.baseUrl)) {
            return meta.baseUrl.trim();
        }
        return computeComponentBaseUrl(meta.agent, meta.componentName, {
            ownerComponent: meta.ownerComponent,
            isDependency: meta.isDependency,
            customPath: meta.customPath
        });
    };

    const fetchComponentAssets = async (meta) => {
        const componentBase = resolveBaseUrl(meta);
        const safeBase = componentBase.replace(/\/+/g, '/');
        const presenterRequested = isNonEmptyString(meta.presenterName);
        const [template, css, presenterSource] = await Promise.all([
            fetchTextOrThrow(`${safeBase}.html`, `[runtime-plugins] Failed to load template for ${meta.componentName}`),
            fetchTextOrThrow(`${safeBase}.css`, `[runtime-plugins] Failed to load stylesheet for ${meta.componentName}`),
            presenterRequested ? fetchOptionalText(`${safeBase}.js`) : Promise.resolve('')
        ]);

        return {
            template,
            css,
            presenterSource,
            safeBase
        };
    };

    const importPresenterModule = async (meta, safeBase, presenterSource) => {
        if (!presenterSource || !presenterSource.trim()) {
            return null;
        }
        if (!isNonEmptyString(meta.presenterName)) {
            return null;
        }
        try {
            const module = await import(/* webpackIgnore: true */ `${safeBase}.js?cacheBust=${Date.now()}`);
            return module;
        } catch (error) {
            console.error(`[runtime-plugins] Failed to import presenter for ${meta.componentName}:`, error);
            return null;
        }
    };

    const loadComponent = async (meta) => {
        const cacheKey = getCacheKey(meta);
        if (!cacheKey) {
            return null;
        }
        if (componentCache.has(cacheKey)) {
            return componentCache.get(cacheKey);
        }

        const componentType = meta?.componentType === 'modals' ? 'modals' : 'components';
        const assets = await fetchComponentAssets(meta);
        const scopedCss = scopeCssToComponent(assets.css, meta.componentName);
        const presenterModuleInstance = await importPresenterModule(meta, assets.safeBase, assets.presenterSource);

        const component = {
            name: meta.componentName,
            componentType,
            loadedTemplate: assets.template,
            loadedCSS: scopedCss,
            presenterClassName: isNonEmptyString(meta.presenterName) ? meta.presenterName.trim() : undefined,
            presenterModule: assets.presenterSource,
            agent: meta.agent
        };

        const registrationPayload = {
            ...component,
            loadedCSSs: [scopedCss],
            type: componentType
        };
        if (
            presenterModuleInstance &&
            component.presenterClassName &&
            presenterModuleInstance[component.presenterClassName]
        ) {
            registrationPayload.presenterModule = presenterModuleInstance;
        }

        await registerRuntimeComponent(webSkel, registrationPayload);

        componentCache.set(cacheKey, component);
        return component;
    };

    return {
        loadComponent,
        getCachedComponent(meta) {
            const cacheKey = getCacheKey(meta);
            return cacheKey ? componentCache.get(cacheKey) : undefined;
        }
    };
}
