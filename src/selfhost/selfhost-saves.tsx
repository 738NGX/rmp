import {
    Alert,
    AlertIcon,
    Badge,
    Box,
    Button,
    Divider,
    FormControl,
    FormLabel,
    HStack,
    IconButton,
    Input,
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Select,
    Stack,
    Text,
    useDisclosure,
} from '@chakra-ui/react';
import React from 'react';
import { MdCloud, MdContentCopy, MdDelete, MdFolder, MdPublic, MdSave } from 'react-icons/md';
import { useRootDispatch, useRootSelector } from '../redux';
import { saveGraph, setSvgViewBoxMin, setSvgViewBoxZoom } from '../redux/param/param-slice';
import { clearSelected, refreshEdgesThunk, refreshNodesThunk } from '../redux/runtime/runtime-slice';
import { makeRenderReadySVGElement } from '../util/download';
import { saveImagesFromParam } from '../util/image';
import { upgrade, RMPSave } from '../util/save';
import {
    acquireSelfHostedSaveLease,
    createSelfHostedGroup,
    createSelfHostedSave,
    deleteSelfHostedGroup,
    deleteSelfHostedSave,
    disableSelfHostedShare,
    duplicateSelfHostedSave,
    enableSelfHostedShare,
    getSelfHostedProfile,
    getSelfHostedSave,
    listSelfHostedGroups,
    listSelfHostedSaves,
    publishSelfHostedSvg,
    releaseSelfHostedSaveLease,
    SelfHostedApiError,
    SelfHostedGroup,
    SelfHostedSaveSummary,
    updateSelfHostedSave,
    updateSelfHostedSaveMetadata,
} from './api';
import { isSelfHosted } from './config';
import { stringifySelfHostedSave } from './save-serializer';

const PASSWORD_KEY = 'rmp__selfhost__password';
const ACTIVE_SAVE_KEY = 'rmp__selfhost__active_save';
const DEVICE_ID_KEY = 'rmp__selfhost__device_id';

const getDeviceId = () => {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    return deviceId;
};

const signalLanguagePreference = (language?: string) => {
    if (language) window.dispatchEvent(new CustomEvent('rmp__selfhost__language', { detail: language }));
};

/** A self-contained client for the companion private save API. */
export default function SelfHostedSaves() {
    const dispatch = useRootDispatch();
    const param = useRootSelector(state => state.param);
    const { languages } = useRootSelector(state => state.fonts);
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [password, setPassword] = React.useState(() => sessionStorage.getItem(PASSWORD_KEY) ?? '');
    const [saves, setSaves] = React.useState<SelfHostedSaveSummary[]>([]);
    const [groups, setGroups] = React.useState<SelfHostedGroup[]>([]);
    const [activeSave, setActiveSave] = React.useState<SelfHostedSaveSummary | null>(null);
    const [newName, setNewName] = React.useState('Untitled map');
    const [newGroupId, setNewGroupId] = React.useState('');
    const [newGroupName, setNewGroupName] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [isConflict, setIsConflict] = React.useState(false);
    const [isBusy, setIsBusy] = React.useState(false);
    const [isConnected, setIsConnected] = React.useState(false);
    const loadingRef = React.useRef(false);
    const activeSaveRef = React.useRef<SelfHostedSaveSummary | null>(null);
    const deviceId = React.useMemo(getDeviceId, []);

    const replaceSave = React.useCallback((save: SelfHostedSaveSummary) => {
        activeSaveRef.current = save;
        setActiveSave(current => (current?.id === save.id ? save : current));
        setSaves(current => current.map(entry => (entry.id === save.id ? save : entry)));
    }, []);

    React.useEffect(() => {
        activeSaveRef.current = activeSave;
    }, [activeSave]);

    const refreshSaves = React.useCallback(async () => {
        const [saveResult, groupResult] = await Promise.all([
            listSelfHostedSaves(password),
            listSelfHostedGroups(password),
        ]);
        setSaves(saveResult.saves);
        setGroups(groupResult.groups);
        setActiveSave(current => saveResult.saves.find(save => save.id === current?.id) ?? current);
        return saveResult.saves;
    }, [password]);

    const authenticate = React.useCallback(async () => {
        setError(null);
        setIsBusy(true);
        try {
            const [loaded, profile] = await Promise.all([refreshSaves(), getSelfHostedProfile(password)]);
            sessionStorage.setItem(PASSWORD_KEY, password);
            signalLanguagePreference(profile.profile.language);
            // A browser reload has not restored the graph into the canvas. Do
            // not mark the remembered save active and risk autosaving the empty
            // canvas over it; the user explicitly loads it from the list.
            if (!loaded.some(save => save.id === activeSaveRef.current?.id)) setActiveSave(null);
            setIsConnected(true);
        } catch (err) {
            sessionStorage.removeItem(PASSWORD_KEY);
            setIsConnected(false);
            setError(err instanceof Error ? err.message : 'Unable to connect to the save service.');
        } finally {
            setIsBusy(false);
        }
    }, [password, refreshSaves]);

    React.useEffect(() => {
        if (password && sessionStorage.getItem(PASSWORD_KEY) && !isConnected) void authenticate();
    }, [authenticate, isConnected, password]);

    const releaseActiveLease = React.useCallback(
        async (save = activeSaveRef.current) => {
            if (save && password) await releaseSelfHostedSaveLease(password, save.id, deviceId).catch(() => undefined);
        },
        [deviceId, password]
    );

    const loadSave = async (id: string) => {
        setError(null);
        setIsConflict(false);
        setIsBusy(true);
        try {
            await acquireSelfHostedSaveLease(password, id, deviceId);
            const result = await getSelfHostedSave(password, id);
            const { images, ...save } = JSON.parse(await upgrade(result.content)) as RMPSave;
            loadingRef.current = true;
            dispatch(clearSelected());
            window.graph.clear();
            window.graph.import(save.graph);
            if (images?.length) await saveImagesFromParam(window.graph, images);
            dispatch(setSvgViewBoxZoom(save.svgViewBoxZoom));
            dispatch(setSvgViewBoxMin(save.svgViewBoxMin));
            dispatch(saveGraph(window.graph.export()));
            dispatch(refreshNodesThunk());
            dispatch(refreshEdgesThunk());
            const previous = activeSaveRef.current;
            if (previous?.id !== result.save.id) await releaseActiveLease(previous);
            activeSaveRef.current = result.save;
            setActiveSave(result.save);
            sessionStorage.setItem(ACTIVE_SAVE_KEY, result.save.id);
        } catch (err) {
            setError(
                err instanceof SelfHostedApiError && err.status === 423
                    ? 'This save is currently being edited on another device. Try again after it is released.'
                    : err instanceof Error
                      ? err.message
                      : 'Unable to load this save.'
            );
        } finally {
            loadingRef.current = false;
            setIsBusy(false);
        }
    };

    const persistActiveSave = React.useCallback(async (): Promise<SelfHostedSaveSummary | undefined> => {
        const currentSave = activeSaveRef.current;
        if (!currentSave || !password || loadingRef.current) return undefined;
        try {
            const content = await stringifySelfHostedSave(param);
            const result = await updateSelfHostedSave(
                password,
                currentSave.id,
                currentSave.revision,
                content,
                undefined,
                deviceId
            );
            replaceSave(result.save);
            return result.save;
        } catch (err) {
            const conflict = err instanceof SelfHostedApiError && err.status === 409;
            setIsConflict(conflict);
            setError(
                conflict
                    ? 'This save changed on another device. Reload it or save your version as a copy.'
                    : err instanceof SelfHostedApiError && err.status === 423
                      ? 'Your editing lease expired. Reload this save before continuing.'
                      : err instanceof Error
                        ? err.message
                        : 'Autosave failed.'
            );
            return undefined;
        }
    }, [deviceId, param, password, replaceSave]);

    React.useEffect(() => {
        if (!activeSave || !password || loadingRef.current) return;
        const timer = window.setTimeout(() => void persistActiveSave(), 2000);
        return () => window.clearTimeout(timer);
    }, [activeSave?.id, param, password, persistActiveSave]);

    React.useEffect(() => {
        if (!activeSave || !password) return;
        const timer = window.setInterval(() => {
            acquireSelfHostedSaveLease(password, activeSave.id, deviceId).catch(() => {
                setError('Your editing lease is no longer available. Reload this save before continuing.');
            });
        }, 15_000);
        return () => window.clearInterval(timer);
    }, [activeSave?.id, deviceId, password]);

    React.useEffect(() => () => void releaseActiveLease(), [releaseActiveLease]);

    const createSave = async () => {
        setError(null);
        setIsBusy(true);
        try {
            const content = await stringifySelfHostedSave(param);
            const result = await createSelfHostedSave(
                password,
                newName.trim() || 'Untitled map',
                content,
                newGroupId || undefined
            );
            await acquireSelfHostedSaveLease(password, result.save.id, deviceId);
            await releaseActiveLease();
            activeSaveRef.current = result.save;
            setSaves(current => [result.save, ...current]);
            setActiveSave(result.save);
            sessionStorage.setItem(ACTIVE_SAVE_KEY, result.save.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to create a save.');
        } finally {
            setIsBusy(false);
        }
    };

    const createGroup = async () => {
        if (!newGroupName.trim()) return;
        setIsBusy(true);
        try {
            const result = await createSelfHostedGroup(password, newGroupName.trim());
            setGroups(current => [...current, result.group]);
            setNewGroupId(result.group.id);
            setNewGroupName('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to create a group.');
        } finally {
            setIsBusy(false);
        }
    };

    const removeGroup = async (id: string) => {
        if (!window.confirm('Remove this group? Its saves will remain ungrouped.')) return;
        try {
            await deleteSelfHostedGroup(password, id);
            setGroups(current => current.filter(group => group.id !== id));
            setSaves(current => current.map(save => (save.groupId === id ? { ...save, groupId: undefined } : save)));
            if (newGroupId === id) setNewGroupId('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to remove this group.');
        }
    };

    const moveSave = async (id: string, groupId: string) => {
        try {
            replaceSave((await updateSelfHostedSaveMetadata(password, id, groupId || undefined)).save);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to move this save.');
        }
    };

    const copySave = async (id: string) => {
        setIsBusy(true);
        try {
            const result = await duplicateSelfHostedSave(password, id);
            setSaves(current => [result.save, ...current]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to copy this save.');
        } finally {
            setIsBusy(false);
        }
    };

    const saveConflictCopy = async () => {
        const current = activeSaveRef.current;
        if (!current) return;
        setIsBusy(true);
        try {
            const content = await stringifySelfHostedSave(param);
            const result = await createSelfHostedSave(
                password,
                `${current.name} (conflict copy)`,
                content,
                current.groupId
            );
            await acquireSelfHostedSaveLease(password, result.save.id, deviceId);
            await releaseActiveLease(current);
            activeSaveRef.current = result.save;
            setSaves(saves => [result.save, ...saves]);
            setActiveSave(result.save);
            sessionStorage.setItem(ACTIVE_SAVE_KEY, result.save.id);
            setIsConflict(false);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to save a conflict copy.');
        } finally {
            setIsBusy(false);
        }
    };

    const removeSave = async (id: string) => {
        if (!window.confirm('Delete this cloud save? This cannot be undone.')) return;
        setError(null);
        setIsBusy(true);
        try {
            await deleteSelfHostedSave(password, id);
            setSaves(current => current.filter(save => save.id !== id));
            if (activeSave?.id === id) {
                await releaseActiveLease(activeSave);
                activeSaveRef.current = null;
                setActiveSave(null);
                sessionStorage.removeItem(ACTIVE_SAVE_KEY);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to delete this save.');
        } finally {
            setIsBusy(false);
        }
    };

    const publishShare = async () => {
        if (!activeSaveRef.current) return;
        setError(null);
        setIsBusy(true);
        try {
            const saved = await persistActiveSave();
            if (!saved) return;
            const shared = saved.share ? saved : (await enableSelfHostedShare(password, saved.id)).save;
            replaceSave(shared);
            const { elem } = await makeRenderReadySVGElement(window.graph, false, false, languages, false, 2);
            const svg = elem.outerHTML.replace(/&nbsp;/g, ' ').replace(/\p{Cc}/gu, '');
            replaceSave((await publishSelfHostedSvg(password, shared.id, shared.revision, svg)).save);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to publish SVG.');
        } finally {
            setIsBusy(false);
        }
    };

    const disableShare = async () => {
        const current = activeSaveRef.current;
        if (!current) return;
        try {
            replaceSave((await disableSelfHostedShare(password, current.id)).save);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to disable public sharing.');
        }
    };

    const shareUrl =
        activeSave?.share?.enabled && activeSave.share.token
            ? `${window.location.origin}/share/${activeSave.share.token}.svg`
            : undefined;
    const groupedSaves = [{ id: '', name: 'Ungrouped' }, ...groups].map(group => ({
        ...group,
        saves: saves.filter(save => (save.groupId ?? '') === group.id),
    }));
    if (!isSelfHosted) return null;

    return (
        <>
            <Menu>
                <MenuButton
                    as={IconButton}
                    size="sm"
                    variant="ghost"
                    aria-label="Self-hosted saves"
                    icon={<MdCloud />}
                    onClick={onOpen}
                />
                <MenuList>
                    <MenuItem icon={<MdSave />} onClick={onOpen}>
                        {activeSave ? `Save: ${activeSave.name}` : 'Self-hosted saves'}
                    </MenuItem>
                </MenuList>
            </Menu>
            <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>Self-hosted saves</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody>
                        <Stack spacing="3">
                            {error && (
                                <Alert status="error" flexWrap="wrap" gap="2">
                                    <AlertIcon />
                                    <Text flex="1">{error}</Text>
                                    {isConflict && activeSave && (
                                        <HStack>
                                            <Button size="xs" onClick={() => void loadSave(activeSave.id)}>
                                                Reload
                                            </Button>
                                            <Button size="xs" onClick={() => void saveConflictCopy()}>
                                                Save copy
                                            </Button>
                                        </HStack>
                                    )}
                                </Alert>
                            )}
                            {!isConnected ? (
                                <FormControl>
                                    <FormLabel>Save service password</FormLabel>
                                    <Input
                                        type="password"
                                        value={password}
                                        onChange={event => setPassword(event.target.value)}
                                        onKeyDown={event => event.key === 'Enter' && void authenticate()}
                                    />
                                </FormControl>
                            ) : (
                                <>
                                    <Text fontSize="sm" color="gray.500">
                                        {activeSave ? `Active: ${activeSave.name}` : 'No active cloud save'}
                                    </Text>
                                    <FormControl>
                                        <FormLabel>New save</FormLabel>
                                        <HStack>
                                            <Input value={newName} onChange={event => setNewName(event.target.value)} />
                                            <Select
                                                width="150px"
                                                value={newGroupId}
                                                onChange={event => setNewGroupId(event.target.value)}
                                            >
                                                <option value="">Ungrouped</option>
                                                {groups.map(group => (
                                                    <option key={group.id} value={group.id}>
                                                        {group.name}
                                                    </option>
                                                ))}
                                            </Select>
                                            <Button onClick={() => void createSave()} isLoading={isBusy}>
                                                Create
                                            </Button>
                                        </HStack>
                                    </FormControl>
                                    <FormControl>
                                        <FormLabel>Groups</FormLabel>
                                        <HStack>
                                            <Input
                                                placeholder="New group name"
                                                value={newGroupName}
                                                onChange={event => setNewGroupName(event.target.value)}
                                                onKeyDown={event => event.key === 'Enter' && void createGroup()}
                                            />
                                            <Button
                                                leftIcon={<MdFolder />}
                                                onClick={() => void createGroup()}
                                                isLoading={isBusy}
                                            >
                                                Add
                                            </Button>
                                        </HStack>
                                        {groups.length > 0 && (
                                            <HStack mt="2" wrap="wrap">
                                                {groups.map(group => (
                                                    <Badge key={group.id} p="1">
                                                        {group.name}{' '}
                                                        <Button
                                                            size="xs"
                                                            variant="link"
                                                            colorScheme="red"
                                                            onClick={() => void removeGroup(group.id)}
                                                        >
                                                            ×
                                                        </Button>
                                                    </Badge>
                                                ))}
                                            </HStack>
                                        )}
                                    </FormControl>
                                    {activeSave && (
                                        <Box borderWidth="1px" borderRadius="md" p="3">
                                            <HStack justify="space-between" align="start">
                                                <Box>
                                                    <Text fontWeight="medium">Public SVG</Text>
                                                    <Text fontSize="sm" color="gray.500">
                                                        Only the rendered SVG is exposed; the editable save stays
                                                        private.
                                                    </Text>
                                                </Box>
                                                {activeSave.share?.enabled && (
                                                    <Badge colorScheme="green">Sharing</Badge>
                                                )}
                                            </HStack>
                                            <HStack mt="2" wrap="wrap">
                                                <Button
                                                    size="sm"
                                                    leftIcon={<MdPublic />}
                                                    onClick={() => void publishShare()}
                                                    isLoading={isBusy}
                                                >
                                                    {activeSave.share?.publishedRevision
                                                        ? 'Update public SVG'
                                                        : 'Publish public SVG'}
                                                </Button>
                                                {activeSave.share?.enabled && (
                                                    <Button
                                                        size="sm"
                                                        colorScheme="red"
                                                        variant="outline"
                                                        onClick={() => void disableShare()}
                                                    >
                                                        Disable
                                                    </Button>
                                                )}
                                                {shareUrl && activeSave.share?.publishedRevision && (
                                                    <Button
                                                        as="a"
                                                        size="sm"
                                                        href={shareUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        Open SVG
                                                    </Button>
                                                )}
                                            </HStack>
                                            {shareUrl && activeSave.share?.publishedRevision && (
                                                <Input
                                                    mt="2"
                                                    size="sm"
                                                    isReadOnly
                                                    value={shareUrl}
                                                    onFocus={event => event.currentTarget.select()}
                                                />
                                            )}
                                        </Box>
                                    )}
                                    <Divider />
                                    {groupedSaves.map(
                                        group =>
                                            group.saves.length > 0 && (
                                                <Stack key={group.id || 'ungrouped'} spacing="1">
                                                    <Text fontWeight="medium" fontSize="sm">
                                                        {group.name}
                                                    </Text>
                                                    {group.saves.map(save => (
                                                        <HStack key={save.id}>
                                                            <Button
                                                                flex="1"
                                                                justifyContent="flex-start"
                                                                variant={
                                                                    activeSave?.id === save.id ? 'solid' : 'outline'
                                                                }
                                                                onClick={() => void loadSave(save.id)}
                                                                isLoading={isBusy}
                                                            >
                                                                {save.name}
                                                            </Button>
                                                            <Select
                                                                aria-label={`Move ${save.name}`}
                                                                size="sm"
                                                                width="125px"
                                                                value={save.groupId ?? ''}
                                                                onChange={event =>
                                                                    void moveSave(save.id, event.target.value)
                                                                }
                                                            >
                                                                <option value="">Ungrouped</option>
                                                                {groups.map(item => (
                                                                    <option key={item.id} value={item.id}>
                                                                        {item.name}
                                                                    </option>
                                                                ))}
                                                            </Select>
                                                            <IconButton
                                                                aria-label={`Copy ${save.name}`}
                                                                size="sm"
                                                                icon={<MdContentCopy />}
                                                                onClick={() => void copySave(save.id)}
                                                            />
                                                            <IconButton
                                                                aria-label={`Delete ${save.name}`}
                                                                size="sm"
                                                                icon={<MdDelete />}
                                                                onClick={() => void removeSave(save.id)}
                                                            />
                                                        </HStack>
                                                    ))}
                                                </Stack>
                                            )
                                    )}
                                    {saves.length === 0 && <Text color="gray.500">No cloud saves yet.</Text>}
                                </>
                            )}
                        </Stack>
                    </ModalBody>
                    <ModalFooter>
                        {!isConnected && (
                            <Button colorScheme="blue" onClick={() => void authenticate()} isLoading={isBusy}>
                                Connect
                            </Button>
                        )}
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
}
