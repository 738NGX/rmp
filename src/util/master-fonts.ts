import { MasterComponent, MasterSvgsElem } from '../constants/master';
import { evaluateMasterSvgAttrs } from './master-attr-binding';
import { getLangStyle, TextLanguage } from './fonts';

const JAPANESE_FONT_ALIASES = new Set(['ja', 'jp', 'jreast_ja', 'tokyo_ja']);
const JAPANESE_FONT_PATTERN =
    /(?:m\s*plus\s*2|a-otf-ud-shin-go|noto\s+sans(?:\s+cjk)?\s+jp|hiragino|yu\s+gothic|meiryo)/i;

const isJapaneseFontFamily = (value: unknown) => {
    if (typeof value !== 'string') return false;
    return JAPANESE_FONT_ALIASES.has(value.trim().toLowerCase()) || JAPANESE_FONT_PATTERN.test(value);
};

const hasJapaneseNameClass = (value: unknown) =>
    typeof value === 'string' && /(?:^|\s)rmp-name__(?:jreast_ja|tokyo_ja)(?:\s|$)/.test(value);

/** Turn the portable `ja` family aliases into RMP's bundled Japanese sans stack. */
export const normalizeMasterFontFamily = (value: unknown) => {
    if (typeof value !== 'string' || !isJapaneseFontFamily(value)) return value;
    return getLangStyle(TextLanguage.jreast_ja).fontFamily;
};

/** The Designer's language classes need the same concrete SVG props as native nodes. */
export const getMasterClassTextStyle = (className: unknown) =>
    hasJapaneseNameClass(className) ? getLangStyle(TextLanguage.jreast_ja) : undefined;

const getStyleFontFamily = (style: unknown) => {
    if (typeof style === 'string') {
        return style.match(/(?:^|;)\s*font-family\s*:\s*([^;]+)/i)?.[1];
    }
    if (style && typeof style === 'object') {
        const styles = style as Record<string, unknown>;
        return styles.fontFamily ?? styles['font-family'];
    }
    return undefined;
};

const containsJapaneseFont = (attrs: Record<string, unknown>) => {
    return (
        isJapaneseFontFamily(attrs['font-family'] ?? attrs.fontFamily ?? attrs.font) ||
        isJapaneseFontFamily(getStyleFontFamily(attrs.style)) ||
        hasJapaneseNameClass(attrs.class ?? attrs.className)
    );
};

/**
 * Master SVGs are not registered in Node2Font. Inspect their resolved text
 * attributes so a Japanese master can request the same bundled font as native
 * Japanese station components.
 */
export const getMasterFontLanguages = (svgs: MasterSvgsElem[], components: MasterComponent[]) => {
    let requiresJapanese = false;

    const visit = (svg: MasterSvgsElem) => {
        const evaluated = evaluateMasterSvgAttrs(svg, components).attrs;
        if (containsJapaneseFont({ ...svg.attrs, ...evaluated })) requiresJapanese = true;
        svg.children?.forEach(visit);
    };

    svgs.forEach(visit);
    return requiresJapanese ? [TextLanguage.jreast_ja] : [];
};
