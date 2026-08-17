import { logger } from '@railmapgen/rmg-runtime';

const SHARE_SANS_FAMILY = 'RMP Share Sans';
const SYSTEM_SANS_FAMILIES = new Set(['arial,sans-serif', 'helvetica,arial,sans-serif']);
const normaliseFontFamily = (family: string) => family.toLowerCase().replaceAll(/\s+/g, '');
const shareSansStack = `'${SHARE_SANS_FAMILY}', Arial, sans-serif`;
// Shared SVGs cannot rely on the desktop-only M PLUS 2 installation. In Edge
// on Android, its CJK fallback can be a serif face even though the source stack
// ends in sans-serif. system-ui selects the platform's UI CJK fallback instead.
const japaneseSystemSansCss = '[font-family*="M PLUS 2"]{font-family:system-ui,sans-serif!important}';

let shareSansCss: Promise<string> | undefined;

const getShareSansCss = () => {
    shareSansCss ??= (async () => {
        // This is a WOFF2 subset of the bundled M Plus 2 font: Latin letters,
        // numbers, punctuation and common map symbols only (about 19 KB).
        const response = await fetch('/rmp/fonts/Mplus2-Latin.woff2');
        if (!response.ok) throw new Error(`Unable to load shared SVG fallback font (${response.status}).`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        return `@font-face{font-family:'${SHARE_SANS_FAMILY}';src:url(data:font/woff2;base64,${btoa(
            binary
        )}) format('woff2');font-style:normal;font-weight:400;font-display:block;}`;
    })();
    return shareSansCss;
};

/** Make default Latin labels portable without embedding a full CJK font. */
export const embedSelfHostedShareFallbackFont = async (elem: SVGSVGElement) => {
    try {
        const defs =
            elem.querySelector(':scope > defs') ?? document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        if (!defs.parentNode) elem.prepend(defs);
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = (await getShareSansCss()) + japaneseSystemSansCss;
        defs.prepend(style);
        elem.querySelectorAll<SVGTextElement>('[font-family]').forEach(text => {
            const family = text.getAttribute('font-family');
            if (family && SYSTEM_SANS_FAMILIES.has(normaliseFontFamily(family)))
                text.style.setProperty('font-family', shareSansStack, 'important');
        });
    } catch (error) {
        // Sharing should remain available even if the optional fallback fails.
        logger.warn('[rmp] Failed to embed the shared SVG Latin fallback font.', error);
    }
};
