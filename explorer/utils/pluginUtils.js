const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

export const DEFAULT_PLUGIN_LOCATIONS = ['document', 'chapter', 'paragraph', 'infoText'];

export function resolveRuntimeAssetUrl(agent, component, assetPath, fallback = '') {
    if (!isNonEmptyString(agent) || !isNonEmptyString(component)) {
        return assetPath;
    }
    if (!isNonEmptyString(assetPath)) {
        return fallback ? `/${agent}/IDE-plugins/${component}/${fallback}` : `/${agent}/IDE-plugins/${component}`;
    }
    const trimmed = assetPath.trim();
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
        return trimmed;
    }
    const withoutLeadingSlash = trimmed.replace(/^\/+/, '');
    if (withoutLeadingSlash.startsWith(`${agent}/IDE-plugins/`) || withoutLeadingSlash.startsWith('IDE-plugins/')) {
        return trimmed.startsWith('/') ? trimmed : `/${withoutLeadingSlash}`;
    }
    const cleaned = withoutLeadingSlash
        .replace(/^\.\/+/, '')
        .split('/')
        .filter((segment) => segment && segment !== '..')
        .join('/');
    return `/${agent}/IDE-plugins/${component}/${cleaned}`;
}

export function computeComponentBaseUrl(agent, component, {ownerComponent, isDependency, customPath} = {}) {
    if (!isNonEmptyString(agent) || !isNonEmptyString(component)) {
        return '';
    }
    if (isNonEmptyString(customPath)) {
        const cleaned = customPath
            .replace(/^\.\/+/, '')
            .replace(/^\/+/, '')
            .replace(/\/+/g, '/');
        return `/${agent}/IDE-plugins/${cleaned}`.replace(/\/+/g, '/');
    }
    if (isDependency && isNonEmptyString(ownerComponent) && ownerComponent.trim() !== component.trim()) {
        const owner = ownerComponent.trim();
        const child = component.trim();
        return `/${agent}/IDE-plugins/${owner}/components/${child}/${child}`;
    }
    return `/${agent}/IDE-plugins/${component}/${component}`;
}

export function normalizeRuntimePlugins(runtimePlugins) {
    if (!runtimePlugins || typeof runtimePlugins !== 'object') {
        return Object.fromEntries(DEFAULT_PLUGIN_LOCATIONS.map((loc) => [loc, []]));
    }

    const normalized = {};

    const ensureBucket = (location) => {
        if (!Array.isArray(normalized[location])) {
            normalized[location] = [];
        }
        return normalized[location];
    };

    for (const [location, entries] of Object.entries(runtimePlugins)) {
        if (!Array.isArray(entries)) {
            continue;
        }

        const bucket = ensureBucket(location);

        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }

            const agent = isNonEmptyString(entry.agent) ? entry.agent.trim() : '';
            const component = isNonEmptyString(entry.component) ? entry.component.trim() : '';
            if (!component) {
                continue;
            }

            const baseUrl = computeComponentBaseUrl(agent, component);
            const normalizedEntry = {
                ...entry,
                component,
                tooltip: isNonEmptyString(entry.tooltip) ? entry.tooltip : component,
                presenter: isNonEmptyString(entry.presenter) ? entry.presenter.trim() : undefined,
                type: isNonEmptyString(entry.type) ? entry.type : 'embedded',
                autoPin: Boolean(entry.autoPin),
                agent,
                icon: resolveRuntimeAssetUrl(agent, component, entry.icon, 'icon.svg'),
                runtime: true,
                componentBaseUrl: baseUrl,
                assetBaseUrl: `/${agent}/IDE-plugins/${component}`
            };

            if (Array.isArray(entry.dependencies) && entry.dependencies.length > 0) {
                normalizedEntry.dependencies = entry.dependencies.map((dependency) => {
                    if (!dependency || typeof dependency !== 'object') {
                        return dependency;
                    }
                    const dependencyAgent = isNonEmptyString(dependency.agent) ? dependency.agent : agent;
                    const dependencyName = isNonEmptyString(dependency.component)
                        ? dependency.component
                        : isNonEmptyString(dependency.name)
                            ? dependency.name
                            : '';
                    const dependencyPath = isNonEmptyString(dependency.path) ? dependency.path : dependency.directory;
                    return {
                        ...dependency,
                        agent: dependencyAgent,
                        component: dependencyName,
                        baseUrl: computeComponentBaseUrl(dependencyAgent, dependencyName, {
                            ownerComponent: dependency.ownerComponent || component,
                            isDependency: true,
                            customPath: dependencyPath
                        })
                    };
                });
            }

            bucket.push(normalizedEntry);
        }
    }

    for (const location of DEFAULT_PLUGIN_LOCATIONS) {
        ensureBucket(location);
    }

    return normalized;
}

export function mergeRuntimePluginsIntoAssistOS(assistOS, runtimePlugins) {
    if (!assistOS || !assistOS.workspace) {
        return;
    }

    const workspacePlugins = assistOS.workspace.plugins || {};
    assistOS.workspace.plugins = workspacePlugins;

    for (const [location, entries] of Object.entries(runtimePlugins || {})) {
        if (!Array.isArray(entries) || entries.length === 0) {
            continue;
        }

        if (!Array.isArray(workspacePlugins[location])) {
            workspacePlugins[location] = [];
        }

        const bucket = workspacePlugins[location];

        for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || !isNonEmptyString(entry.component)) {
                continue;
            }

            const existingIndex = bucket.findIndex((plugin) => plugin && plugin.component === entry.component);
            if (existingIndex !== -1) {
                bucket.splice(existingIndex, 1);
            }

            bucket.push(entry);
        }
    }
}

export async function fetchTextOrThrow(url, description) {
    const response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) {
        throw new Error(`${description} (${response.status})`);
    }
    return response.text();
}

export async function fetchOptionalText(url) {
    const response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) {
        return '';
    }
    return response.text();
}

export function scopeCssToComponent(cssText, componentName) {
    if (!isNonEmptyString(cssText) || !isNonEmptyString(componentName)) {
        return cssText || '';
    }
    const tag = componentName.trim();

    const scopeSelector = (selector) => {
        if (!selector) return '';
        let scoped = selector.trim();
        if (!scoped) return '';
        scoped = scoped.replace(/:host\b/g, tag);
        if (scoped.startsWith(tag) || scoped.startsWith('@')) {
            return scoped;
        }
        return `${tag} ${scoped}`;
    };

    return cssText.replace(/(^|})\s*([^{}@][^{}]*)\{/g, (match, prefix, selectorGroup) => {
        const scopedSelectors = selectorGroup
            .split(',')
            .map(scopeSelector)
            .filter(Boolean)
            .join(', ');
        return `${prefix} ${scopedSelectors} {`;
    });
}

export async function registerRuntimeComponent(webSkel, componentDefinition) {
    const {name, loadedTemplate, loadedCSSs, presenterClassName, presenterModule} = componentDefinition;
    const resourceManager = webSkel.ResourceManager;

    const ensurePresenterRegistered = async () => {
        if (presenterClassName && presenterModule && presenterModule[presenterClassName]) {
            resourceManager.registerPresenter(name, presenterModule[presenterClassName]);
        }
    };

    const updateResourceEntry = async () => {
        const entry = resourceManager.components[name] || {
            html: '',
            css: [],
            presenter: null,
            loadingPromise: null,
            isPromiseFulfilled: false
        };
        entry.html = loadedTemplate;
        entry.css = Array.isArray(loadedCSSs) ? loadedCSSs : [];
        entry.isPromiseFulfilled = true;
        entry.loadingPromise = Promise.resolve({html: entry.html, css: entry.css});
        resourceManager.components[name] = entry;

        if (entry.css.length > 0) {
            try {
                await resourceManager.unloadStyleSheets(name);
            } catch (_) { /* ignore */
            }
            await resourceManager.loadStyleSheets(entry.css, name);
        }
        await ensurePresenterRegistered();
    };

    if (!customElements.get(name)) {
        await webSkel.defineComponent(componentDefinition);
        await ensurePresenterRegistered();
        return;
    }

    await updateResourceEntry();

    const existingConfigIndex = webSkel.configs.components.findIndex((c) => c && c.name === name);
    if (existingConfigIndex !== -1) {
        webSkel.configs.components[existingConfigIndex] = {
            ...webSkel.configs.components[existingConfigIndex],
            loadedTemplate,
            loadedCSSs: loadedCSSs || []
        };
    } else {
        webSkel.configs.components.push({
            name,
            loadedTemplate,
            loadedCSSs: loadedCSSs || []
        });
    }
}

async function openPlugin(componentName, type, context, presenter, autoPin = false) {
    const registry = assistOS.workspace.plugins[type];
    if (!Array.isArray(registry)) {
        console.warn(`[runtime-plugins] Missing plugin registry for type "${type}".`);
        return;
    }
    const plugin = registry.find((p) => p && p.component === componentName);
    if (!plugin) {
        console.warn(`[runtime-plugins] Plugin "${componentName}" not found for type "${type}".`);
        return;
    }
    await initializePlugin(plugin);
    highlightPlugin(type, componentName, presenter);
    if (plugin.type === "embedded") {
        let pluginContainer = presenter.element.querySelector(`.${type}-plugin-container`);
        let contextString = encodeURIComponent(JSON.stringify(context));
        pluginContainer.classList.add("plugin-open");
        pluginContainer.innerHTML = `<${componentName} data-pin="${autoPin}" class="assistos-plugin" data-type="${type}" data-context="${contextString}" data-presenter="${componentName}"></${componentName}>`;
    } else {
        await assistOS.UI.showModal(componentName, {
            context: encodeURIComponent(JSON.stringify(context)),
        }, true);
        removeHighlightPlugin(type, presenter);
    }
    let pluginElement = presenter.element.querySelector(componentName);
    if (pluginElement) {
        let firstEditableItem = pluginElement.closest('[data-local-action^="editItem "]');
        if (firstEditableItem) {
            pluginElement.addEventListener("click", () => {
                firstEditableItem.click();
            });
        }
    }
}

function removeHighlightPlugin(type, presenter) {
    let highlightPluginClass = `${type}-highlight-plugin`;
    let pluginIcon = presenter.element.querySelector(`.icon-container.${highlightPluginClass}`);
    if (pluginIcon) {
        pluginIcon.classList.remove(highlightPluginClass);
    }

}

function highlightPlugin(type, componentName, presenter) {
    let highlightPluginClass = `${type}-highlight-plugin`;
    let highlightPlugin = presenter.element.querySelector(`.${highlightPluginClass}`);
    if (highlightPlugin) {
        highlightPlugin.classList.remove(highlightPluginClass);
    }
    let pluginIcon = presenter.element.querySelector(`.icon-container.${componentName}`);
    pluginIcon.classList.add(highlightPluginClass);
}

async function initializePlugin(plugin) {
    if (!plugin || plugin.initialized) {
        return;
    }
    plugin.initialized = true;
}

async function renderPluginIcons(containerElement, type) {
    const registry = assistOS.workspace.plugins[type];
    const plugins = Array.isArray(registry) ? registry : [];
    for (const plugin of plugins) {
        if (!plugin) continue;
        if (plugin.iconPresenter && plugin.iconComponent) {
            const iconContainer = document.createElement("div");
            const iconContext = {icon: plugin.icon, plugin: plugin.component, type};
            const contextString = encodeURIComponent(JSON.stringify(iconContext));
            iconContainer.innerHTML = `<${plugin.iconComponent} data-context="${contextString}" data-presenter="${plugin.iconComponent}"></${plugin.iconComponent}>`;
            attachPluginTooltip(iconContainer, plugin, type, plugin.autoPin);
            containerElement.appendChild(iconContainer);
        } else {
            const iconSrc = await getPluginIcon(plugin);
            const containerDiv = document.createElement("div");
            containerDiv.innerHTML = `<img class="pointer black-icon" loading="lazy" src="${iconSrc}" alt="icon">`;
            attachPluginTooltip(containerDiv, plugin, type, plugin.autoPin);
            containerElement.appendChild(containerDiv);
        }
    }
}

function attachPluginTooltip(containerElement, plugin, type, autoPin = false) {
    containerElement.classList.add("icon-container", "plugin-circle", plugin.component, "pointer");
    containerElement.setAttribute("data-local-action", `openPlugin ${type} ${plugin.component} ${autoPin}`);
    let tooltip = containerElement.querySelector(".plugin-name");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.classList.add("plugin-name");
        tooltip.innerHTML = plugin.tooltip;
        containerElement.appendChild(tooltip);
    }
    containerElement.addEventListener("mouseover", async () => {
        containerElement.querySelector(".plugin-name").style.display = "block";
    });
    containerElement.addEventListener("mouseout", async () => {
        containerElement.querySelector(".plugin-name").style.display = "none";
    });
    containerElement.addEventListener("plugin-modal-closed", () => {
        containerElement.classList.remove(`${type}-highlight-plugin`);
    });
}

async function getPluginIcon(plugin) {
    const icon = typeof plugin.icon === 'string' ? plugin.icon.trim() : '';
    if (!icon) {
        return '';
    }
    if (icon.startsWith('data:') || /^https?:\/\//i.test(icon)) {
        return icon;
    }
    const agent = plugin.agent || '';
    const normalized = icon.replace(/^\/+/, '');
    if (agent) {
        const alreadyAgentPath = normalized.startsWith(`${agent}/IDE-plugins/`) || normalized.startsWith(`IDE-plugins/`);
        if (alreadyAgentPath) {
            return icon.startsWith('/') ? icon : `/${normalized}`;
        }
        return `/${agent}/IDE-plugins/${plugin.component}/${normalized}`;
    }
    return icon.startsWith('/') ? icon : `/${normalized}`;
}


const pluginUtils = {
    openPlugin,
    renderPluginIcons,
    removeHighlightPlugin,
};

export default pluginUtils;
