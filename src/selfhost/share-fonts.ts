import { logger } from '@railmapgen/rmg-runtime';

const SHARE_SANS_FAMILY = 'RMP Share Sans';
const SYSTEM_SANS_FAMILIES = new Set(['arial,sans-serif', 'helvetica,arial,sans-serif']);
const normaliseFontFamily = (family: string) => family.toLowerCase().replaceAll(/\s+/g, '');
const shareSansStack = `'${SHARE_SANS_FAMILY}', Arial, sans-serif`;
// Public SVGs do not embed CJK fonts. Match the known, sans-serif RMP template
// stacks and use platform-native CJK sans fonts for each language instead.
// Do not include the MTR Chinese stack here: it deliberately ends in serif.
const cjkSystemSansCss = [
    '[font-family*="M PLUS 2"]{font-family:"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Yu Gothic",Meiryo,sans-serif!important}',
    '[font-family*="SimHei"]{font-family:"Noto Sans CJK SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif!important}',
    '[font-family*="Taipei Sans TC Beta"]{font-family:"Noto Sans CJK TC","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif!important}',
].join('');

let shareSansCss: Promise<string> | undefined;

const getShareSansCss = () => {
    shareSansCss ??= (async () => {
        // This is a WOFF2 subset of Roboto Regular: English, numbers and
        // Latin Extended-A (including Japanese romanisation macrons) only.
        // It is smaller than the former M Plus 2 subset at about 17 KB.
        const response = await fetch('/rmp/fonts/Roboto-Latin.woff2');
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
        style.textContent = (await getShareSansCss()) + cjkSystemSansCss;
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
