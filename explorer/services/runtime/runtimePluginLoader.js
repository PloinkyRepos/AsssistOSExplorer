import {
    mergeRuntimePluginsIntoAssistOS,
    normalizeRuntimePlugins
} from '../../utils/pluginUtils.js';

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

export function createRuntimePluginLoader({
    agentId,
    runtimePluginTool,
    assistosSDK,
    componentRegistry
}) {
    if (!assistosSDK) {
        throw new Error('[runtime] runtimePluginLoader requires assistOS SDK.');
    }
    if (!componentRegistry) {
        throw new Error('[runtime] runtimePluginLoader requires a component registry.');
    }

    let cachedRawPlugins = null;
    let cachedNormalizedPlugins = null;
    let inflightFetch = null;

    const fetchRuntimePlugins = async () => {
        if (cachedRawPlugins && cachedNormalizedPlugins) {
            return {
                raw: cachedRawPlugins,
                normalized: cachedNormalizedPlugins
            };
        }
        if (inflightFetch) {
            return inflightFetch;
        }

        inflightFetch = (async () => {
            const rawPlugins = await assistosSDK.fetchRuntimePlugins(agentId, runtimePluginTool);
            const normalized = normalizeRuntimePlugins(rawPlugins);
            cachedRawPlugins = rawPlugins || {};
            cachedNormalizedPlugins = normalized;
            return {
                raw: cachedRawPlugins,
                normalized: cachedNormalizedPlugins
            };
        })();

        try {
            return await inflightFetch;
        } finally {
            inflightFetch = null;
        }
    };

    const scheduleComponents = (runtimePlugins) => {
        const scheduled = new Map();
        const scheduleComponent = (meta) => {
            const componentName = meta?.componentName;
            const agent = meta?.agent;
            if (!isNonEmptyString(componentName) || !isNonEmptyString(agent)) {
                return;
            }
            const key = `${agent.trim()}::${componentName.trim()}`;
            if (!scheduled.has(key)) {
                scheduled.set(key, {
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

        for (const entries of Object.values(runtimePlugins || {})) {
            if (!Array.isArray(entries)) {
                continue;
            }
            for (const plugin of entries) {
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
                        scheduleComponent({
                            componentName: dependency.component || dependency.name,
                            presenterName: dependency.presenter || dependency.presenterClassName,
                            agent: dependency.agent || plugin.agent,
                            ownerComponent: dependency.ownerComponent || plugin.component,
                            isDependency: true,
                            customPath: dependency.path || dependency.directory,
                            baseUrl: dependency.baseUrl
                        });
                    }
                }
            }
        }

        return scheduled;
    };

    const loadComponents = async (runtimePlugins) => {
        const scheduled = scheduleComponents(runtimePlugins);
        const entries = Array.from(scheduled.entries());
        if (!entries.length) {
            return new Map();
        }

        const loadPromises = entries.map(async ([key, meta]) => {
            try {
                const component = await componentRegistry.loadComponent(meta);
                return [key, component];
            } catch (error) {
                console.error(`[runtime-plugins] Failed to load component ${meta.componentName} from agent ${meta.agent}:`, error);
                return [key, null];
            }
        });

        const results = await Promise.allSettled(loadPromises);
        const loaded = new Map();
        for (const result of results) {
            if (result.status !== 'fulfilled') {
                continue;
            }
            const [key, component] = result.value;
            if (component) {
                loaded.set(key, component);
            }
        }
        return loaded;
    };

    const mergeIntoAssistOS = (assistOS, runtimePlugins) => {
        mergeRuntimePluginsIntoAssistOS(assistOS, runtimePlugins);
    };

    return {
        fetchRuntimePlugins,
        loadComponents,
        mergeIntoAssistOS
    };
}
