import {
    Alert,
    AlertIcon,
    Box,
    Button,
    FormControl,
    FormLabel,
    HStack,
    Input,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalOverlay,
    Select,
    Stack,
    Text,
    Textarea,
} from '@chakra-ui/react';
import { RmgAutoComplete, RmgLabel } from '@railmapgen/rmg-components';
import React from 'react';
import { MdAdd, MdDelete } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import { MasterParam } from '../constants/master';
import { listSelfHostedMasterLibrary, replaceSelfHostedMasterLibrary, SelfHostedMasterLibraryEntry } from './api';
import { isSelfHosted } from './config';

const PASSWORD_KEY = 'rmp__selfhost__password';

const getLabels = (language: string) => {
    if (language.startsWith('zh-Hans'))
        return {
            library: '本地大师节点库',
            manage: '管理本地大师节点',
            choose: '从本地库选择',
            name: '模板名称',
            group: '分组路径',
            groupHint: '可用 / 建立层级，例如：日本/东京/地铁。留空即为未分组。',
            allGroups: '全部分组',
            allSubgroups: '全部下级分组',
            ungrouped: '未分组',
            config: '配置 JSON',
            save: '保存模板',
            new: '新建模板',
            remove: '删除模板',
            close: '关闭',
            noPassword: '请先在“自托管存档”中连接保存服务。',
            invalid: '配置必须是一个 JSON 对象。',
        };
    if (language.startsWith('zh-Hant'))
        return {
            library: '本機大師節點庫',
            manage: '管理本機大師節點',
            choose: '從本機庫選擇',
            name: '範本名稱',
            group: '群組路徑',
            groupHint: '可用 / 建立層級，例如：日本/東京/地鐵。留空即為未分組。',
            allGroups: '全部群組',
            allSubgroups: '全部下層群組',
            ungrouped: '未分組',
            config: '設定 JSON',
            save: '儲存範本',
            new: '新增範本',
            remove: '刪除範本',
            close: '關閉',
            noPassword: '請先在「自託管存檔」中連線儲存服務。',
            invalid: '設定必須是一個 JSON 物件。',
        };
    return {
        library: 'Local master library',
        manage: 'Manage local masters',
        choose: 'Choose from local library',
        name: 'Template name',
        group: 'Group path',
        groupHint: 'Use / for levels, for example Japan/Tokyo/Metro. Leave empty for ungrouped.',
        allGroups: 'All groups',
        allSubgroups: 'All subgroups',
        ungrouped: 'Ungrouped',
        config: 'Configuration JSON',
        save: 'Save template',
        new: 'New template',
        remove: 'Delete template',
        close: 'Close',
        noPassword: 'Connect to Self-hosted saves before managing local masters.',
        invalid: 'Configuration must be a JSON object.',
    };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const getGroupPath = (entry: SelfHostedMasterLibraryEntry) =>
    (entry.group ?? '')
        .split('/')
        .map(segment => segment.trim())
        .filter(Boolean);

const normalizeGroup = (group: string) =>
    group
        .split('/')
        .map(segment => segment.trim())
        .filter(Boolean)
        .join('/');

const groupLabel = (entry: SelfHostedMasterLibraryEntry, labels: ReturnType<typeof getLabels>) => {
    const path = getGroupPath(entry);
    return path.length > 0 ? path.join(' / ') : labels.ungrouped;
};

/** Export a reusable definition, never the component values from one canvas instance. */
export const makeMasterLibraryConfig = (master: MasterParam): Record<string, unknown> => {
    const components = structuredClone(master.components).map(component => ({
        ...component,
        value: component.defaultValue,
    }));
    const config: Record<string, unknown> = {
        id: master.randomId,
        type: master.nodeType,
        label: master.label,
        svgs: master.svgs,
        components,
        core: master.core,
        transform: master.transform,
        version: master.version,
    };
    if (master.version !== 4 && master.color) config.color = { ...master.color, value: master.color.defaultValue };
    return config;
};

const newEntryId = () => `local-master-${crypto.randomUUID().replaceAll('-', '')}`;

export function SelfHostedMasterLibraryPicker(props: {
    onSelect: (config: Record<string, unknown>) => void;
    onManage: () => void;
}) {
    const { onSelect, onManage } = props;
    const { i18n } = useTranslation();
    const labels = getLabels(i18n.language);
    const password = sessionStorage.getItem(PASSWORD_KEY) ?? '';
    const [masters, setMasters] = React.useState<SelfHostedMasterLibraryEntry[]>([]);
    const [selectedId, setSelectedId] = React.useState('');
    const [selectedGroupPath, setSelectedGroupPath] = React.useState<string[]>([]);

    React.useEffect(() => {
        if (!isSelfHosted || !password) return;
        void listSelfHostedMasterLibrary(password)
            .then(result => setMasters(result.masters))
            .catch(() => setMasters([]));
    }, [password]);

    if (!isSelfHosted) return null;
    if (!password) return <Text color="orange.500">{labels.noPassword}</Text>;
    const selected = masters.find(master => master.id === selectedId);
    const groupLevels = Array.from(
        { length: Math.max(0, ...masters.map(master => getGroupPath(master).length)) },
        (_, depth) => {
            if (depth > 0 && !selectedGroupPath[depth - 1]) return [];
            return Array.from(
                new Set(
                    masters
                        .filter(master =>
                            selectedGroupPath.slice(0, depth).every((segment, index) => {
                                return !segment || getGroupPath(master)[index] === segment;
                            })
                        )
                        .map(master => getGroupPath(master)[depth])
                        .filter((segment): segment is string => !!segment)
                )
            ).sort((left, right) => left.localeCompare(right));
        }
    );
    const visibleMasters = masters.filter(master =>
        selectedGroupPath.every((segment, index) => !segment || getGroupPath(master)[index] === segment)
    );
    const options = visibleMasters.map(entry => ({ id: entry.id, value: entry.name, entry }));
    return (
        <RmgLabel label={labels.choose}>
            <Stack spacing="2">
                {groupLevels.map((groups, depth) =>
                    groups.length > 0 ? (
                        <Select
                            key={depth}
                            size="sm"
                            value={selectedGroupPath[depth] ?? ''}
                            aria-label={depth === 0 ? labels.allGroups : labels.allSubgroups}
                            onChange={event => {
                                const group = event.target.value;
                                setSelectedGroupPath(previous => {
                                    const next = previous.slice(0, depth);
                                    if (group) next[depth] = group;
                                    return next;
                                });
                                setSelectedId('');
                            }}
                        >
                            <option value="">{depth === 0 ? labels.allGroups : labels.allSubgroups}</option>
                            {groups.map(group => (
                                <option key={group} value={group}>
                                    {group}
                                </option>
                            ))}
                        </Select>
                    ) : null
                )}
                <HStack align="start">
                    <Box flex="1">
                        <RmgAutoComplete
                            data={options}
                            displayHandler={item => <Text noOfLines={1}>{item.value}</Text>}
                            filter={(query, item) => {
                                const needle = query.toLowerCase();
                                const configId = item.entry.config.id ?? item.entry.config.randomId ?? '';
                                const label = item.entry.config.label ?? '';
                                return [item.value, String(configId), String(label)].some(value =>
                                    value.toLowerCase().includes(needle)
                                );
                            }}
                            value={selected?.name ?? ''}
                            onChange={item => {
                                setSelectedId(item.id);
                                onSelect(item.entry.config);
                            }}
                        />
                    </Box>
                    <Button size="sm" onClick={onManage}>
                        {labels.manage}
                    </Button>
                </HStack>
            </Stack>
        </RmgLabel>
    );
}

export function SelfHostedMasterLibraryManager(props: {
    isOpen: boolean;
    onClose: () => void;
    initialConfig?: Record<string, unknown>;
    initialName?: string;
    onChanged?: () => void;
}) {
    const { isOpen, onClose, initialConfig, initialName, onChanged } = props;
    const { i18n } = useTranslation();
    const labels = getLabels(i18n.language);
    const password = sessionStorage.getItem(PASSWORD_KEY) ?? '';
    const [masters, setMasters] = React.useState<SelfHostedMasterLibraryEntry[]>([]);
    const [selectedId, setSelectedId] = React.useState('');
    const [name, setName] = React.useState('');
    const [group, setGroup] = React.useState('');
    const [configText, setConfigText] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [isBusy, setIsBusy] = React.useState(false);

    const newTemplate = React.useCallback(() => {
        setSelectedId('');
        setName(initialName ?? 'My master');
        setGroup('');
        setConfigText(initialConfig ? JSON.stringify(initialConfig, null, 2) : '');
        setError(null);
    }, [initialConfig, initialName]);

    React.useEffect(() => {
        if (!isOpen || !password) return;
        setIsBusy(true);
        void listSelfHostedMasterLibrary(password)
            .then(result => {
                setMasters(result.masters);
                newTemplate();
            })
            .catch(err => setError(err instanceof Error ? err.message : 'Unable to load local masters.'))
            .finally(() => setIsBusy(false));
    }, [isOpen, newTemplate, password]);

    const select = (entry: SelfHostedMasterLibraryEntry) => {
        setSelectedId(entry.id);
        setName(entry.name);
        setGroup(entry.group ?? '');
        setConfigText(JSON.stringify(entry.config, null, 2));
        setError(null);
    };

    const save = async () => {
        let config: unknown;
        try {
            config = JSON.parse(configText);
        } catch {
            setError(labels.invalid);
            return;
        }
        if (!isRecord(config)) {
            setError(labels.invalid);
            return;
        }
        const now = new Date().toISOString();
        const current = masters.find(entry => entry.id === selectedId);
        const entry: SelfHostedMasterLibraryEntry = {
            id: current?.id ?? newEntryId(),
            name: name.trim() || 'Untitled master',
            group: normalizeGroup(group) || undefined,
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
            config,
        };
        const next = current ? masters.map(item => (item.id === entry.id ? entry : item)) : [...masters, entry];
        setError(null);
        setIsBusy(true);
        try {
            const result = await replaceSelfHostedMasterLibrary(password, next);
            setMasters(result.masters);
            setSelectedId(entry.id);
            onChanged?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to save local master.');
        } finally {
            setIsBusy(false);
        }
    };

    const remove = async () => {
        if (!selectedId) return;
        const next = masters.filter(entry => entry.id !== selectedId);
        setError(null);
        setIsBusy(true);
        try {
            const result = await replaceSelfHostedMasterLibrary(password, next);
            setMasters(result.masters);
            newTemplate();
            onChanged?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to delete local master.');
        } finally {
            setIsBusy(false);
        }
    };

    if (!isSelfHosted) return null;
    return (
        <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
            <ModalOverlay />
            <ModalContent>
                <ModalHeader>{labels.library}</ModalHeader>
                <ModalCloseButton />
                <ModalBody p="0">
                    <Stack spacing="3" p="3" overflowY="auto" maxH="70vh">
                        <HStack>
                            <Text fontWeight="bold" flex="1">
                                {labels.library}
                            </Text>
                            <Button size="sm" leftIcon={<MdAdd />} onClick={newTemplate} isDisabled={isBusy}>
                                {labels.new}
                            </Button>
                        </HStack>
                        {!password && (
                            <Alert status="warning">
                                <AlertIcon />
                                {labels.noPassword}
                            </Alert>
                        )}
                        {error && (
                            <Alert status="error">
                                <AlertIcon />
                                {error}
                            </Alert>
                        )}
                        {masters.length > 0 &&
                            Array.from(
                                masters.reduce((groups, entry) => {
                                    const key = groupLabel(entry, labels);
                                    groups.set(key, [...(groups.get(key) ?? []), entry]);
                                    return groups;
                                }, new Map<string, SelfHostedMasterLibraryEntry[]>())
                            )
                                .sort(([left], [right]) => left.localeCompare(right))
                                .map(([groupName, entries]) => (
                                    <Stack key={groupName} spacing="1">
                                        <Text fontSize="sm" color="gray.500" fontWeight="bold">
                                            {groupName}
                                        </Text>
                                        <HStack wrap="wrap">
                                            {entries.map(entry => (
                                                <Button
                                                    key={entry.id}
                                                    size="sm"
                                                    variant={entry.id === selectedId ? 'solid' : 'outline'}
                                                    onClick={() => select(entry)}
                                                >
                                                    {entry.name}
                                                </Button>
                                            ))}
                                        </HStack>
                                    </Stack>
                                ))}
                        <FormControl>
                            <FormLabel>{labels.name}</FormLabel>
                            <Input
                                value={name}
                                onChange={event => setName(event.target.value)}
                                isDisabled={!password || isBusy}
                            />
                        </FormControl>
                        <FormControl>
                            <FormLabel>{labels.group}</FormLabel>
                            <Input
                                value={group}
                                onChange={event => setGroup(event.target.value)}
                                placeholder="Japan/Tokyo/Metro"
                                isDisabled={!password || isBusy}
                            />
                            <Text fontSize="xs" color="gray.500" mt="1">
                                {labels.groupHint}
                            </Text>
                        </FormControl>
                        <FormControl>
                            <FormLabel>{labels.config}</FormLabel>
                            <Textarea
                                minH="240px"
                                value={configText}
                                onChange={event => setConfigText(event.target.value)}
                                fontFamily="monospace"
                                fontSize="sm"
                                isDisabled={!password || isBusy}
                            />
                        </FormControl>
                        <HStack>
                            <Button
                                colorScheme="blue"
                                onClick={() => void save()}
                                isLoading={isBusy}
                                isDisabled={!password || !configText}
                            >
                                {labels.save}
                            </Button>
                            <Button
                                colorScheme="red"
                                leftIcon={<MdDelete />}
                                onClick={() => void remove()}
                                isDisabled={!selectedId || isBusy}
                            >
                                {labels.remove}
                            </Button>
                            <Button ml="auto" variant="outline" onClick={onClose}>
                                {labels.close}
                            </Button>
                        </HStack>
                    </Stack>
                </ModalBody>
            </ModalContent>
        </Modal>
    );
}
