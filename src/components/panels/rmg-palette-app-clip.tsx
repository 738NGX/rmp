import { Box, Button, CloseButton, SystemStyleObject } from '@chakra-ui/react';
import { RmgAppClip } from '@railmapgen/rmg-components';
import rmgRuntime, { logger } from '@railmapgen/rmg-runtime';
import React from 'react';
import { Theme } from '../../constants/constants';
import { isSelfHosted } from '../../selfhost/config';
import SelfHostedPaletteManager from '../../selfhost/palette-manager';

const CHANNEL_PREFIX = 'rmg-palette-bridge--';

const styles: SystemStyleObject = {
    position: 'relative',
    h: 460,
    maxH: '70%',

    '& > .palette-close-button': {
        position: 'absolute',
        right: 1,
        top: 1,
    },

    '& iframe': {
        h: '100%',
        w: '100%',
    },
};

interface RmgPaletteAppClip {
    isOpen: boolean;
    onClose: () => void;
    defaultTheme?: Theme;
    onSelect: (theme: Theme) => void;
}

export default function RmgPaletteAppClip(props: RmgPaletteAppClip) {
    const { isOpen, onClose, defaultTheme, onSelect } = props;

    const [appClipId] = React.useState(crypto.randomUUID());
    const [isLoaded, setIsLoaded] = React.useState(false);
    const [isManagingLocalPalettes, setIsManagingLocalPalettes] = React.useState(false);
    const [paletteRevision, setPaletteRevision] = React.useState(0);

    const frameUrl =
        '/rmg-palette/#/picker?' +
        new URLSearchParams({
            parentComponent: rmgRuntime.getAppName(),
            parentId: appClipId,
        });

    const channelRef = React.useRef<BroadcastChannel | undefined>(undefined);

    React.useEffect(() => {
        const channel = new BroadcastChannel(CHANNEL_PREFIX + appClipId);
        channelRef.current = channel;

        channel.onmessage = ev => {
            const { event, data } = ev.data;
            logger.debug('[rmp] Received event from Palette app clip:', event);
            if (event === 'CLOSE') {
                onClose();
            } else if (event === 'SELECT') {
                onSelect(data as Theme);
            } else if (event === 'LOADED') {
                // force trigger default theme update again when app clip first opened
                setIsLoaded(true);
            }
        };

        return () => {
            channel.close();
        };
    }, []);

    React.useEffect(() => {
        if (defaultTheme) {
            channelRef.current?.postMessage({ event: 'OPEN', data: defaultTheme });
        }
    }, [isLoaded, defaultTheme?.toString()]);

    React.useEffect(() => {
        if (!isOpen) setIsManagingLocalPalettes(false);
    }, [isOpen]);

    return (
        <RmgAppClip size="md" isOpen={isOpen} onClose={onClose} sx={styles}>
            <CloseButton className="palette-close-button" onClick={onClose} />
            {isSelfHosted && (
                <Button
                    position="absolute"
                    right="10"
                    top="1"
                    size="xs"
                    zIndex="1"
                    onClick={() => setIsManagingLocalPalettes(current => !current)}
                >
                    {isManagingLocalPalettes ? 'Palette' : 'Manage local palettes'}
                </Button>
            )}
            {isManagingLocalPalettes ? (
                <Box height="100%" overflow="hidden">
                    <SelfHostedPaletteManager
                        onDone={() => {
                            setPaletteRevision(current => current + 1);
                            setIsManagingLocalPalettes(false);
                        }}
                    />
                </Box>
            ) : (
                <iframe key={paletteRevision} src={frameUrl} loading="eager" />
            )}
        </RmgAppClip>
    );
}
