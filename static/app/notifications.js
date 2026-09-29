let requested = false;

export function requestPermission() {
	if (requested || !("Notification" in window) || !window.isSecureContext) return;
	if (Notification.permission !== "default") return;
	requested = true;
	try {
		if (localStorage.getItem("pi-ui-notifications-requested")) return;
		localStorage.setItem("pi-ui-notifications-requested", "true");
	} catch {
		// Storage may be disabled; still ask at most once in this tab.
	}
	void Notification.requestPermission().catch(() => {});
}

export function show({ workspace, sessionPath }) {
	if (!("Notification" in window) || Notification.permission !== "granted") return;
	if (document.hasFocus()) return;
	try {
		const notification = new Notification(`${workspace} finished`, {
			icon: document.querySelector('link[rel="icon"]')?.href,
			tag: sessionPath || workspace,
		});
		notification.onclick = () => {
			window.focus();
			notification.close();
		};
	} catch {
		// Notifications are best-effort (some mobile browsers require a service worker).
	}
}
