import {
    Alert,
    AlertIcon,
    Box,
    Button,
    FormControl,
    FormLabel,
    HStack,
    IconButton,
    Input,
    Stack,
    Text,
} from '@chakra-ui/react';
import React from 'react';
import { MdAdd, MdDelete } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import {
    listSelfHostedPaletteCities,
    replaceSelfHostedPaletteCities,
    SelfHostedPaletteCity,
    SelfHostedPaletteLine,
} from './api';

const PASSWORD_KEY = 'rmp__selfhost__password';

const getLabels = (language: string) => {
    if (language.startsWith('zh-Hans'))
        return {
            title: '管理本地色板',
            city: '城市名称',
            line: '线路名称',
            addCity: '新增城市',
            addLine: '新增线路',
            save: '保存并返回',
            noPassword: '请先在“自托管存档”中连接保存服务。',
        };
    if (language.startsWith('zh-Hant'))
        return {
            title: '管理本機色板',
            city: '城市名稱',
            line: '路線名稱',
            addCity: '新增城市',
            addLine: '新增路線',
            save: '儲存並返回',
            noPassword: '請先在「自託管存檔」中連線儲存服務。',
        };
    return {
        title: 'Manage local palettes',
        city: 'City name',
        line: 'Line name',
        addCity: 'Add city',
        addLine: 'Add line',
        save: 'Save and return',
        noPassword: 'Connect to Self-hosted saves before managing palettes.',
    };
};

const newLine = (): SelfHostedPaletteLine => ({
    id: `line-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
    name: { en: 'New line' },
    colour: '#1976D2',
    fg: '#fff',
});

const newCity = (): SelfHostedPaletteCity => ({
    id: `selfhost-${crypto.randomUUID().replaceAll('-', '')}`,
    name: { en: 'My city' },
    lines: [newLine()],
});

const withOptionalName = (name: Record<string, string>, language: string, value: string) => {
    const next = { ...name };
    if (value) next[language] = value;
    else delete next[language];
    return next;
};

/** Editor displayed inside the normal RMG palette app clip, not as a second picker. */
export default function SelfHostedPaletteManager(props: { onDone: () => void }) {
    const { onDone } = props;
    const { i18n } = useTranslation();
    const labels = getLabels(i18n.language);
    const [cities, setCities] = React.useState<SelfHostedPaletteCity[]>([]);
    const [selectedId, setSelectedId] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [isBusy, setIsBusy] = React.useState(true);
    const password = sessionStorage.getItem(PASSWORD_KEY) ?? '';

    React.useEffect(() => {
        if (!password) {
            setIsBusy(false);
            return;
        }
        void listSelfHostedPaletteCities(password)
            .then(result => {
                setCities(result.cities);
                setSelectedId(result.cities[0]?.id ?? '');
            })
            .catch(err => setError(err instanceof Error ? err.message : 'Unable to load local palettes.'))
            .finally(() => setIsBusy(false));
    }, [password]);

    const selected = cities.find(city => city.id === selectedId);
    const updateSelected = (next: SelfHostedPaletteCity) =>
        setCities(current => current.map(city => (city.id === next.id ? next : city)));

    const addCity = () => {
        const city = newCity();
        setCities(current => [...current, city]);
        setSelectedId(city.id);
    };

    const save = async () => {
        if (!password) return;
        setError(null);
        setIsBusy(true);
        try {
            await replaceSelfHostedPaletteCities(password, cities);
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to save local palettes.');
        } finally {
            setIsBusy(false);
        }
    };

    if (!password)
        return (
            <Alert status="warning">
                <AlertIcon />
                {labels.noPassword}
            </Alert>
        );

    return (
        <Stack spacing="3" p="3" overflowY="auto" height="100%">
            <HStack>
                <Text fontWeight="bold" flex="1">
                    {labels.title}
                </Text>
                <Button size="sm" leftIcon={<MdAdd />} onClick={addCity}>
                    {labels.addCity}
                </Button>
            </HStack>
            {error && (
                <Alert status="error">
                    <AlertIcon />
                    {error}
                </Alert>
            )}
            {cities.length === 0 && <Text color="gray.500">No local palettes yet.</Text>}
            {cities.length > 0 && (
                <HStack wrap="wrap">
                    {cities.map(city => (
                        <Button
                            key={city.id}
                            size="sm"
                            variant={city.id === selectedId ? 'solid' : 'outline'}
                            onClick={() => setSelectedId(city.id)}
                        >
                            {city.name['zh-Hans'] ?? city.name.en}
                        </Button>
                    ))}
                </HStack>
            )}
            {selected && (
                <>
                    <FormControl>
                        <FormLabel>{labels.city} (English)</FormLabel>
                        <Input
                            value={selected.name.en}
                            onChange={event =>
                                updateSelected({ ...selected, name: { ...selected.name, en: event.target.value } })
                            }
                        />
                    </FormControl>
                    <FormControl>
                        <FormLabel>{labels.city}（简体）</FormLabel>
                        <Input
                            value={selected.name['zh-Hans'] ?? ''}
                            onChange={event =>
                                updateSelected({
                                    ...selected,
                                    name: withOptionalName(selected.name, 'zh-Hans', event.target.value),
                                })
                            }
                        />
                    </FormControl>
                    <FormControl>
                        <FormLabel>{labels.city}（繁體）</FormLabel>
                        <Input
                            value={selected.name['zh-Hant'] ?? ''}
                            onChange={event =>
                                updateSelected({
                                    ...selected,
                                    name: withOptionalName(selected.name, 'zh-Hant', event.target.value),
                                })
                            }
                        />
                    </FormControl>
                    <Text fontWeight="medium">{labels.line}</Text>
                    {selected.lines.map(line => (
                        <HStack key={line.id}>
                            <Input
                                flex="1"
                                value={line.name.en}
                                onChange={event =>
                                    updateSelected({
                                        ...selected,
                                        lines: selected.lines.map(item =>
                                            item.id === line.id
                                                ? { ...item, name: { ...item.name, en: event.target.value } }
                                                : item
                                        ),
                                    })
                                }
                            />
                            <Input
                                width="72px"
                                type="color"
                                value={line.colour}
                                onChange={event =>
                                    updateSelected({
                                        ...selected,
                                        lines: selected.lines.map(item =>
                                            item.id === line.id
                                                ? { ...item, colour: event.target.value as `#${string}` }
                                                : item
                                        ),
                                    })
                                }
                            />
                            <IconButton
                                aria-label={`Delete ${line.name.en}`}
                                size="sm"
                                icon={<MdDelete />}
                                onClick={() =>
                                    updateSelected({
                                        ...selected,
                                        lines: selected.lines.filter(item => item.id !== line.id),
                                    })
                                }
                            />
                        </HStack>
                    ))}
                    <Button
                        size="sm"
                        variant="outline"
                        leftIcon={<MdAdd />}
                        onClick={() => updateSelected({ ...selected, lines: [...selected.lines, newLine()] })}
                    >
                        {labels.addLine}
                    </Button>
                </>
            )}
            <Box flex="1" />
            <Button colorScheme="blue" onClick={() => void save()} isLoading={isBusy}>
                {labels.save}
            </Button>
        </Stack>
    );
}
