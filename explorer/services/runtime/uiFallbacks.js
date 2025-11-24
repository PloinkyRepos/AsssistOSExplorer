export function attachUiFallbacks(webSkel) {
    if (!webSkel) {
        return;
    }
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
}
