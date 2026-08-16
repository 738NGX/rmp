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
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Select,
    SimpleGrid,
    Stack,
    Text,
    Tooltip,
    useDisclosure,
} from '@chakra-ui/react';
import React from 'react';
import { MdDelete, MdPalette } from 'react-icons/md';
import { MonoColour } from '@railmapgen/rmg-palette-resources';
import { CityCode, Theme } from '../constants/constants';
import { SelfHostedThemePreset, listSelfHostedThemePresets, replaceSelfHostedThemePresets } from './api';
import { isSelfHosted } from './config';

const PASSWORD_KEY = 'rmp__selfhost__password';

const getRecommendedForeground = (hex: string): MonoColour => {
    const rgb = Number.parseInt(hex.slice(1), 16);
    const red = (rgb >> 16) & 255;
    const green = (rgb >> 8) & 255;
    const blue = rgb & 255;
    return red * 0.299 + green * 0.587 + blue * 0.114 > 186 ? MonoColour.black : MonoColour.white;
};

/** Named, server-backed custom colour presets for self-hosted RMP. */
export default function CustomThemePicker(props: { onSelect: (theme: Theme) => void }) {
    const { onSelect } = props;
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [password, setPassword] = React.useState(() => sessionStorage.getItem(PASSWORD_KEY) ?? '');
    const [presets, setPresets] = React.useState<SelfHostedThemePreset[]>([]);
    const [name, setName] = React.useState('Custom colour');
    const [hex, setHex] = React.useState('#1976D2');
    const [foreground, setForeground] = React.useState<MonoColour>(MonoColour.white);
    const [error, setError] = React.useState<string | null>(null);
    const [isBusy, setIsBusy] = React.useState(false);

    const loadPresets = React.useCallback(async () => {
        const result = await listSelfHostedThemePresets(password);
        setPresets(result.presets);
        return result.presets;
    }, [password]);

    const connect = async () => {
        setError(null);
        setIsBusy(true);
        try {
            await loadPresets();
            sessionStorage.setItem(PASSWORD_KEY, password);
        } catch (err) {
            sessionStorage.removeItem(PASSWORD_KEY);
            setError(err instanceof Error ? err.message : 'Unable to connect to the preset service.');
        } finally {
            setIsBusy(false);
        }
    };

    const savePresets = async (nextPresets: SelfHostedThemePreset[]) => {
        setIsBusy(true);
        try {
            const result = await replaceSelfHostedThemePresets(password, nextPresets);
            setPresets(result.presets);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to save custom presets.');
        } finally {
            setIsBusy(false);
        }
    };

    const addPreset = async () => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError('A preset name is required.');
            return;
        }
        const normalizedHex = hex.toUpperCase();
        const theme: Theme = [
            CityCode.Other,
            `custom-${crypto.randomUUID()}`,
            normalizedHex as `#${string}`,
            foreground,
        ];
        await savePresets([...presets, { id: crypto.randomUUID(), name: trimmedName, theme }]);
    };

    const removePreset = async (id: string) => {
        if (!window.confirm('Delete this custom colour preset?')) return;
        await savePresets(presets.filter(preset => preset.id !== id));
    };

    const selectPreset = (theme: Theme) => {
        onSelect(theme);
        onClose();
    };

    if (!isSelfHosted) return null;

    return (
        <>
            <Tooltip label="Custom colour presets">
                <IconButton aria-label="Custom colour presets" size="md" icon={<MdPalette />} onClick={onOpen} />
            </Tooltip>
            <Modal isOpen={isOpen} onClose={onClose} size="md" scrollBehavior="inside">
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>Custom colour presets</ModalHeader>
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
                                        onKeyDown={event => event.key === 'Enter' && void connect()}
                                    />
                                </FormControl>
                            ) : (
                                <>
                                    <SimpleGrid columns={{ base: 2, md: 3 }} spacing="2">
                                        {presets.map(preset => (
                                            <Box key={preset.id} display="flex" gap="1">
                                                <Button
                                                    flex="1"
                                                    minW="0"
                                                    bg={preset.theme[2]}
                                                    color={preset.theme[3]}
                                                    _hover={{ filter: 'brightness(0.9)' }}
                                                    onClick={() => selectPreset(preset.theme)}
                                                    overflow="hidden"
                                                    textOverflow="ellipsis"
                                                >
                                                    {preset.name}
                                                </Button>
                                                <IconButton
                                                    aria-label={`Delete ${preset.name}`}
                                                    size="sm"
                                                    icon={<MdDelete />}
                                                    onClick={() => void removePreset(preset.id)}
                                                />
                                            </Box>
                                        ))}
                                    </SimpleGrid>
                                    {presets.length === 0 && <Text color="gray.500">No custom presets yet.</Text>}
                                    <FormControl>
                                        <FormLabel>Preset name</FormLabel>
                                        <Input
                                            value={name}
                                            maxLength={80}
                                            onChange={event => setName(event.target.value)}
                                        />
                                    </FormControl>
                                    <HStack>
                                        <FormControl>
                                            <FormLabel>Colour</FormLabel>
                                            <Input
                                                type="color"
                                                value={hex}
                                                onChange={event => {
                                                    setHex(event.target.value);
                                                    setForeground(getRecommendedForeground(event.target.value));
                                                }}
                                            />
                                        </FormControl>
                                        <FormControl>
                                            <FormLabel>Text colour</FormLabel>
                                            <Select
                                                value={foreground}
                                                onChange={event => setForeground(event.target.value as MonoColour)}
                                            >
                                                <option value={MonoColour.white}>White</option>
                                                <option value={MonoColour.black}>Black</option>
                                            </Select>
                                        </FormControl>
                                    </HStack>
                                    <Button onClick={() => void addPreset()} isLoading={isBusy}>
                                        Add preset
                                    </Button>
                                </>
                            )}
                        </Stack>
                    </ModalBody>
                    <ModalFooter>
                        {!sessionStorage.getItem(PASSWORD_KEY) && (
                            <Button colorScheme="blue" onClick={() => void connect()} isLoading={isBusy}>
                                Connect
                            </Button>
                        )}
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
}
