import { describe, expect, it } from 'vitest';
import { MasterComponent, MasterSvgsElem } from '../constants/master';
import { TextLanguage } from './fonts';
import { getMasterClassTextStyle, getMasterFontLanguages, normalizeMasterFontFamily } from './master-fonts';

const components: MasterComponent[] = [{ id: 'font', label: 'font', type: 'select', defaultValue: 'ja' }];

describe('master fonts', () => {
    it('maps the portable ja alias to the bundled Japanese stack', () => {
        expect(String(normalizeMasterFontFamily('ja'))).toContain('M PLUS 2');
        expect(String(normalizeMasterFontFamily('Noto Sans JP, sans-serif'))).toContain('M PLUS 2');
    });

    it('loads Japanese when a v4 font binding resolves to ja', () => {
        const svgs: MasterSvgsElem[] = [
            {
                id: 'label',
                type: 'text',
                attrBindings: { 'font-family': { kind: 'variable', componentId: 'font' } },
            },
        ];

        expect(getMasterFontLanguages(svgs, components)).toEqual([TextLanguage.jreast_ja]);
    });

    it('loads Japanese when the family is declared in an SVG style string', () => {
        const svgs: MasterSvgsElem[] = [
            { id: 'label', type: 'text', attrs: { style: 'font-family: M PLUS 2; font-size: 16px' } },
        ];

        expect(getMasterFontLanguages(svgs, [])).toEqual([TextLanguage.jreast_ja]);
    });

    it('recognizes the Designer Japanese name class', () => {
        expect(getMasterClassTextStyle('rmp-name__jreast_ja')?.fontFamily).toContain('M PLUS 2');
    });
});
