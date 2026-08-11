import {
    Alert,
    AlertIcon,
    Box,
    Button,
    Divider,
    FormControl,
    FormLabel,
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
    Stack,
    Text,
    useDisclosure,
} from '@chakra-ui/react';
import React from 'react';
import { MdCloud, MdDelete, MdSave } from 'react-icons/md';
import { useRootDispatch, useRootSelector } from '../redux';
import { saveGraph, setSvgViewBoxMin, setSvgViewBoxZoom } from '../redux/param/param-slice';
import { clearSelected, refreshEdgesThunk, refreshNodesThunk } from '../redux/runtime/runtime-slice';
import { saveImagesFromParam } from '../util/image';
import { upgrade, RMPSave } from '../util/save';
import {
    createSelfHostedSave,
    deleteSelfHostedSave,
    getSelfHostedSave,
    listSelfHostedSaves,
    SelfHostedApiError,
    SelfHostedSaveSummary,
    updateSelfHostedSave,
} from './api';
import { isSelfHosted } from './config';
import { stringifySelfHostedSave } from './save-serializer';

const PASSWORD_KEY = 'rmp__selfhost__password';
const ACTIVE_SAVE_KEY = 'rmp__selfhost__active_save';

/** A small, self-contained client for the companion self-host save API. */
export default function SelfHostedSaves() {
    const dispatch = useRootDispatch();
    const param = useRootSelector(state => state.param);
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [password, setPassword] = React.useState(() => sessionStorage.getItem(PASSWORD_KEY) ?? '');
    const [saves, setSaves] = React.useState<SelfHostedSaveSummary[]>([]);
    const [activeSave, setActiveSave] = React.useState<SelfHostedSaveSummary | null>(null);
    const [newName, setNewName] = React.useState('Untitled map');
    const [error, setError] = React.useState<string | null>(null);
    const [isBusy, setIsBusy] = React.useState(false);
    const loadingRef = React.useRef(false);
    const activeSaveRef = React.useRef<SelfHostedSaveSummary | null>(null);

    React.useEffect(() => {
        activeSaveRef.current = activeSave;
    }, [activeSave]);

    const refreshSaves = React.useCallback(async () => {
        const result = await listSelfHostedSaves(password);
        setSaves(result.saves);
        setActiveSave(current => result.saves.find(save => save.id === current?.id) ?? current);
        return result.saves;
    }, [password]);

    const authenticate = async () => {
        setError(null);
        setIsBusy(true);
        try {
            const loaded = await refreshSaves();
            sessionStorage.setItem(PASSWORD_KEY, password);
            const rememberedId = sessionStorage.getItem(ACTIVE_SAVE_KEY);
            setActiveSave(loaded.find(save => save.id === rememberedId) ?? null);
        } catch (err) {
            sessionStorage.removeItem(PASSWORD_KEY);
            setError(err instanceof Error ? err.message : 'Unable to connect to the save service.');
        } finally {
            setIsBusy(false);
        }
    };

    const loadSave = async (id: string) => {
        setError(null);
        setIsBusy(true);
        try {
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

            setActiveSave(result.save);
            sessionStorage.setItem(ACTIVE_SAVE_KEY, result.save.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to load this save.');
        } finally {
            loadingRef.current = false;
            setIsBusy(false);
        }
    };

    const persistActiveSave = React.useCallback(async () => {
        const currentSave = activeSaveRef.current;
        if (!currentSave || !password || loadingRef.current) return;
        try {
            const content = await stringifySelfHostedSave(param);
            const result = await updateSelfHostedSave(password, currentSave.id, currentSave.revision, content);
            setActiveSave(result.save);
            setSaves(current => current.map(save => (save.id === result.save.id ? result.save : save)));
        } catch (err) {
            const message =
                err instanceof SelfHostedApiError && err.status === 409
                    ? 'This save changed on another device. Reload it before saving again.'
                    : err instanceof Error
                      ? err.message
                      : 'Autosave failed.';
            setError(message);
        }
    }, [param, password]);

    React.useEffect(() => {
        if (!activeSave || !password || loadingRef.current) return;
        const timer = window.setTimeout(() => void persistActiveSave(), 2000);
        return () => window.clearTimeout(timer);
    }, [activeSave?.id, param, password, persistActiveSave]);

    const createSave = async () => {
        setError(null);
        setIsBusy(true);
        try {
            const content = await stringifySelfHostedSave(param);
            const result = await createSelfHostedSave(password, newName.trim() || 'Untitled map', content);
            setSaves(current => [result.save, ...current]);
            setActiveSave(result.save);
            sessionStorage.setItem(ACTIVE_SAVE_KEY, result.save.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to create a save.');
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
                setActiveSave(null);
                sessionStorage.removeItem(ACTIVE_SAVE_KEY);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to delete this save.');
        } finally {
            setIsBusy(false);
        }
    };

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

            <Modal isOpen={isOpen} onClose={onClose} size="md" scrollBehavior="inside">
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>Self-hosted saves</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody>
                        <Stack spacing="3">
                            {error && (
                                <Alert status="error">
                                    <AlertIcon />
                                    {error}
                                </Alert>
                            )}
                            {!sessionStorage.getItem(PASSWORD_KEY) ? (
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
                                        <FormLabel>New save name</FormLabel>
                                        <Box display="flex" gap="2">
                                            <Input value={newName} onChange={event => setNewName(event.target.value)} />
                                            <Button onClick={() => void createSave()} isLoading={isBusy}>
                                                Create
                                            </Button>
                                        </Box>
                                    </FormControl>
                                    <Divider />
                                    {saves.map(save => (
                                        <Box key={save.id} display="flex" alignItems="center" gap="2">
                                            <Button
                                                flex="1"
                                                justifyContent="flex-start"
                                                variant={activeSave?.id === save.id ? 'solid' : 'outline'}
                                                onClick={() => void loadSave(save.id)}
                                                isLoading={isBusy}
                                            >
                                                {save.name}
                                            </Button>
                                            <IconButton
                                                aria-label={`Delete ${save.name}`}
                                                size="sm"
                                                icon={<MdDelete />}
                                                onClick={() => void removeSave(save.id)}
                                            />
                                        </Box>
                                    ))}
                                    {saves.length === 0 && <Text color="gray.500">No cloud saves yet.</Text>}
                                </>
                            )}
                        </Stack>
                    </ModalBody>
                    <ModalFooter>
                        {!sessionStorage.getItem(PASSWORD_KEY) && (
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
