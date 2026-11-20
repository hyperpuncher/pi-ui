const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";
const openDurationMs = 160;
const closeDurationMs = 120;
const reducedDurationMs = 100;
const maxCachedDecodedUrls = 100;
const decodedUrls = new Set();
const inflightPreloads = new Map();

function isPrimaryClick(event) {
	return (
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	);
}

function prefersReducedMotion() {
	return window.matchMedia(reducedMotionQuery).matches;
}

function preloadImage(url) {
	if (!url || decodedUrls.has(url)) return undefined;
	const pending = inflightPreloads.get(url);
	if (pending) return pending;
	const loader = new Image();
	loader.src = url;
	const request = loader
		.decode()
		.then(() => {
			if (decodedUrls.size >= maxCachedDecodedUrls) decodedUrls.clear();
			decodedUrls.add(url);
			return loader;
		})
		.finally(() => {
			inflightPreloads.delete(url);
		});
	inflightPreloads.set(url, request);
	return request;
}

function isRectVisible(rect) {
	return (
		rect.width > 0 &&
		rect.height > 0 &&
		rect.bottom > 0 &&
		rect.top < window.innerHeight &&
		rect.right > 0 &&
		rect.left < window.innerWidth
	);
}

function flipTransform(fromRect, toRect) {
	const dx = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
	const dy = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
	const sx = fromRect.width / toRect.width;
	const sy = fromRect.height / toRect.height;
	return `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`;
}

function setLightboxSize(image, width, height) {
	if (width > 0 && height > 0) {
		image.style.setProperty("--image-lightbox-width", `${width}px`);
		image.style.setProperty("--image-lightbox-ratio", String(width / height));
		image.setAttribute("data-sized", "");
		return;
	}
	image.style.removeProperty("--image-lightbox-width");
	image.style.removeProperty("--image-lightbox-ratio");
	image.removeAttribute("data-sized");
}

function resolveTranscriptImage(target) {
	if (!(target instanceof Element) || !target.closest("#messages")) return undefined;

	const frame = target.closest(".message-image-frame");
	if (frame) {
		const image = frame.querySelector("img.message-image");
		if (!(image instanceof HTMLImageElement)) return undefined;
		const fullSrc =
			frame instanceof HTMLAnchorElement
				? frame.href
				: image.currentSrc || image.src;
		return fullSrc ? { image, fullSrc } : undefined;
	}

	const markdownImage = target.closest('.markdown-content img[data-markdown="img"]');
	if (markdownImage instanceof HTMLImageElement && !markdownImage.closest("a[href]")) {
		const fullSrc = markdownImage.currentSrc || markdownImage.src;
		return fullSrc ? { image: markdownImage, fullSrc } : undefined;
	}

	return undefined;
}

export function bindImageLightbox() {
	const dialog = document.getElementById("image-lightbox");
	if (!(dialog instanceof HTMLDialogElement)) return;
	const lightboxImage = dialog.querySelector(".image-lightbox-image");
	if (!(lightboxImage instanceof HTMLImageElement)) return;
	const closeButton = dialog.querySelector(".image-lightbox-close");

	let activeSource;
	let activeAnimations = [];
	let isClosing = false;
	let loadToken = 0;

	const cancelAnimations = () => {
		for (const animation of activeAnimations) animation.cancel();
		activeAnimations = [];
	};

	const restoreSource = () => {
		if (activeSource) activeSource.style.visibility = "";
	};

	const resetLightbox = () => {
		cancelAnimations();
		restoreSource();
		lightboxImage.removeAttribute("src");
		lightboxImage.alt = "";
		setLightboxSize(lightboxImage, 0, 0);
		activeSource = undefined;
	};

	const runTransition = (imageKeyframes, fadeKeyframes, options) => {
		const imageAnimation = lightboxImage.animate(imageKeyframes, options);
		activeAnimations = [
			imageAnimation,
			dialog.animate(fadeKeyframes, { ...options, pseudoElement: "::backdrop" }),
		];
		if (closeButton instanceof HTMLElement) {
			activeAnimations.push(
				closeButton.animate(fadeKeyframes, {
					...options,
					duration:
						options.fill === "forwards"
							? Math.min(options.duration, 80)
							: options.duration,
				}),
			);
		}
		return imageAnimation;
	};

	const openLightbox = (sourceImage, fullSrc) => {
		loadToken += 1;
		const token = loadToken;
		cancelAnimations();
		restoreSource();
		activeSource = sourceImage;
		isClosing = false;

		const fromRect = sourceImage.getBoundingClientRect();
		const thumbSrc = sourceImage.currentSrc || sourceImage.src;
		const useFullImmediately =
			!thumbSrc || fullSrc === thumbSrc || decodedUrls.has(fullSrc);
		lightboxImage.alt = sourceImage.alt;
		lightboxImage.src = useFullImmediately ? fullSrc : thumbSrc;

		const fullWidth =
			Number(sourceImage.dataset.fullWidth) || sourceImage.naturalWidth;
		const fullHeight =
			Number(sourceImage.dataset.fullHeight) || sourceImage.naturalHeight;
		setLightboxSize(lightboxImage, fullWidth, fullHeight);

		if (!dialog.open) dialog.showModal();

		const toRect = lightboxImage.getBoundingClientRect();
		const canFlip =
			!prefersReducedMotion() &&
			isRectVisible(fromRect) &&
			toRect.width > 0 &&
			toRect.height > 0;
		const fadeIn = [{ opacity: 0 }, { opacity: 1 }];

		if (canFlip) {
			sourceImage.style.visibility = "hidden";
			runTransition(
				[
					{ transform: flipTransform(fromRect, toRect) },
					{ transform: "translate3d(0, 0, 0) scale(1, 1)" },
				],
				fadeIn,
				{ duration: openDurationMs, easing: easeOut },
			);
		} else {
			runTransition(fadeIn, fadeIn, {
				duration: reducedDurationMs,
				easing: "ease",
			});
		}

		if (!useFullImmediately && fullSrc) {
			void preloadImage(fullSrc)
				?.then((loader) => {
					if (token !== loadToken || isClosing || !activeSource) return;
					if (loader.naturalWidth > 0 && loader.naturalHeight > 0) {
						setLightboxSize(
							lightboxImage,
							loader.naturalWidth,
							loader.naturalHeight,
						);
					}
					lightboxImage.src = fullSrc;
				})
				.catch(() => {
					// Keep the already-decoded thumbnail visible if full-res load fails.
				});
		}
	};

	const closeLightbox = () => {
		if (!dialog.open || isClosing) return;
		isClosing = true;
		loadToken += 1;
		cancelAnimations();

		const fromRect = lightboxImage.getBoundingClientRect();
		const targetRect = activeSource?.isConnected
			? activeSource.getBoundingClientRect()
			: undefined;
		const reduced = prefersReducedMotion();
		const canFlipBack =
			!reduced &&
			targetRect !== undefined &&
			isRectVisible(targetRect) &&
			fromRect.width > 0 &&
			fromRect.height > 0;
		const fadeOut = [{ opacity: 1 }, { opacity: 0 }];
		const imageAnimation = runTransition(
			canFlipBack
				? [
						{ transform: "translate3d(0, 0, 0) scale(1, 1)" },
						{ transform: flipTransform(targetRect, fromRect) },
					]
				: fadeOut,
			fadeOut,
			{
				duration: reduced ? reducedDurationMs : closeDurationMs,
				easing: reduced ? "ease" : easeOut,
				fill: "forwards",
			},
		);

		void imageAnimation.finished.then(
			() => {
				if (!isClosing) return;
				isClosing = false;
				dialog.close();
				resetLightbox();
			},
			() => {},
		);
	};

	document.addEventListener("pointerdown", (event) => {
		if (!isPrimaryClick(event)) return;
		const resolved = resolveTranscriptImage(event.target);
		if (resolved) void preloadImage(resolved.fullSrc)?.catch(() => {});
	});

	document.addEventListener("click", (event) => {
		if (!isPrimaryClick(event)) return;
		const resolved = resolveTranscriptImage(event.target);
		if (!resolved) return;
		event.preventDefault();
		openLightbox(resolved.image, resolved.fullSrc);
	});

	closeButton?.addEventListener("click", () => closeLightbox());
	lightboxImage.addEventListener("click", (event) => {
		if (isPrimaryClick(event)) closeLightbox();
	});

	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		closeLightbox();
	});

	dialog.addEventListener("close", () => {
		if (!isClosing) resetLightbox();
	});

	// Fallback for browsers without native <dialog closedby="any"> light-dismiss.
	if (!("closedBy" in HTMLDialogElement.prototype)) {
		let pressedOutside = false;
		const outside = (event) => {
			if (event.target !== dialog) return false;
			const rect = dialog.getBoundingClientRect();
			return (
				event.clientX < rect.left ||
				event.clientX > rect.right ||
				event.clientY < rect.top ||
				event.clientY > rect.bottom
			);
		};
		dialog.addEventListener("pointerdown", (event) => {
			pressedOutside = outside(event);
		});
		dialog.addEventListener("pointerup", (event) => {
			if (pressedOutside && outside(event)) closeLightbox();
			pressedOutside = false;
		});
	}
}
