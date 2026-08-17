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

    React.useEffect(() => {
        if (!isSelfHosted || !password) return;
        void listSelfHostedMasterLibrary(password)
            .then(result => setMasters(result.masters))
            .catch(() => setMasters([]));
    }, [password]);

    if (!isSelfHosted) return null;
    if (!password) return <Text color="orange.500">{labels.noPassword}</Text>;
    const selected = masters.find(master => master.id === selectedId);
    const options = masters.map(entry => ({ id: entry.id, value: entry.name, entry }));
    return (
        <RmgLabel label={labels.choose}>
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
    const [configText, setConfigText] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [isBusy, setIsBusy] = React.useState(false);

    const newTemplate = React.useCallback(() => {
        setSelectedId('');
        setName(initialName ?? 'My master');
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
                        {masters.length > 0 && (
                            <HStack wrap="wrap">
                                {masters.map(entry => (
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
                        )}
                        <FormControl>
                            <FormLabel>{labels.name}</FormLabel>
                            <Input
                                value={name}
                                onChange={event => setName(event.target.value)}
                                isDisabled={!password || isBusy}
                            />
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
