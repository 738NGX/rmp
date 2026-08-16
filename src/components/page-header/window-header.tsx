import { Flex, Heading, HStack, IconButton, Menu, MenuButton, MenuItem, MenuList } from '@chakra-ui/react';
import { RmgEnvBadge, RmgWindowHeader, useReadyConfig } from '@railmapgen/rmg-components';
import rmgRuntime, { RmgEnv } from '@railmapgen/rmg-runtime';
import { LANGUAGE_NAMES, LanguageCode } from '@railmapgen/rmg-translate';
import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { MdHelp, MdRedo, MdSettings, MdTranslate, MdUndo } from 'react-icons/md';
import { Events } from '../../constants/constants';
import { useRootDispatch, useRootSelector } from '../../redux';
import { redoAction, undoAction } from '../../redux/param/param-slice';
import { useScreenOrientation } from '../../util/hooks';
import SelfHostedSaves from '../../selfhost/selfhost-saves';
import { getSelfHostedProfile, updateSelfHostedProfile } from '../../selfhost/api';
import { isSelfHosted } from '../../selfhost/config';
import AboutModal from './about-modal';
import DownloadActions from './download-actions';
import OpenActions from './open-actions';
import { SearchPopover } from './search-popover';
import SettingsModal from './settings-modal';
import { ZoomPopover } from './zoom-popover';

export default function WindowHeader() {
    const { t } = useTranslation();
    const dispatch = useRootDispatch();
    const { past, future } = useRootSelector(state => state.param);
    const isAllowAppTelemetry = rmgRuntime.isAllowAnalytics();

    const [isSettingsModalOpen, setIsSettingsModalOpen] = React.useState(false);
    const [isAboutModalOpen, setIsAboutModalOpen] = React.useState(false);

    const environment = useReadyConfig(rmgRuntime.getEnv);
    const appVersion = useReadyConfig(rmgRuntime.getAppVersion);

    const orientation = useScreenOrientation();

    React.useEffect(() => {
        if (!isSelfHosted) return;
        const applyLanguage = (language?: string) => {
            if ((['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko'] as string[]).includes(language ?? '')) {
                localStorage.setItem('rmp__selfhost__language', language!);
                void rmgRuntime.getI18nInstance().changeLanguage(language as LanguageCode);
            }
        };
        applyLanguage(localStorage.getItem('rmp__selfhost__language') ?? undefined);
        const password = sessionStorage.getItem('rmp__selfhost__password');
        if (password)
            void getSelfHostedProfile(password)
                .then(result => applyLanguage(result.profile.language))
                .catch(() => undefined);
        const onLanguage = (event: Event) => applyLanguage((event as CustomEvent<string>).detail);
        window.addEventListener('rmp__selfhost__language', onLanguage);
        return () => window.removeEventListener('rmp__selfhost__language', onLanguage);
    }, []);

    React.useEffect(() => {
        // environment !== RmgEnv.DEV -> wait after rmgRuntime.ready() in useReadyConfig
        if (isAllowAppTelemetry && environment !== RmgEnv.DEV)
            rmgRuntime.event(Events.APP_LOAD, { isStandaloneWindow: rmgRuntime.isStandaloneWindow() });
    }, [environment]);

    const handleChangeLanguage = (language: LanguageCode) => {
        rmgRuntime.getI18nInstance().changeLanguage(language);
        if (isSelfHosted) {
            localStorage.setItem('rmp__selfhost__language', language);
            const password = sessionStorage.getItem('rmp__selfhost__password');
            if (password) void updateSelfHostedProfile(password, { language }).catch(() => undefined);
        }
    };
    const handleUndo = () => {
        dispatch(undoAction());
    };
    const handleRedo = () => {
        dispatch(redoAction());
    };

    return (
        <RmgWindowHeader>
            <Flex direction={orientation === 'landscape' ? 'row' : 'column'} width="100%">
                <HStack height="32px">
                    <Heading as="h4" size="md" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                        {t('header.about.rmp')}
                    </Heading>
                    <RmgEnvBadge
                        environment={environment}
                        version={appVersion}
                        popoverHeader={
                            environment === RmgEnv.PRD ? undefined : (
                                <Trans i18nKey="header.popoverHeader" environment={environment}>
                                    You&apos;re on {{ environment }} environment!
                                </Trans>
                            )
                        }
                        popoverBody={
                            environment === RmgEnv.PRD ? undefined : (
                                <Trans i18nKey="header.popoverBody">
                                    This is a testing environment where we test the latest beta RMP.
                                </Trans>
                            )
                        }
                    />
                </HStack>

                <HStack overflowX="auto" ml={orientation === 'landscape' ? 'auto' : undefined}>
                    <SearchPopover />

                    <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label="Undo"
                        icon={<MdUndo />}
                        isDisabled={past.length === 0}
                        onClick={handleUndo}
                    />
                    <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label="Redo"
                        icon={<MdRedo />}
                        isDisabled={future.length === 0}
                        onClick={handleRedo}
                    />

                    <ZoomPopover />

                    <OpenActions />

                    <DownloadActions />

                    <SelfHostedSaves />

                    {rmgRuntime.isStandaloneWindow() && (
                        <Menu>
                            <MenuButton as={IconButton} icon={<MdTranslate />} variant="ghost" size="sm" />
                            <MenuList>
                                {(['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko'] as LanguageCode[]).map(lang => (
                                    <MenuItem key={lang} onClick={() => handleChangeLanguage(lang)}>
                                        {LANGUAGE_NAMES[lang][lang]}
                                    </MenuItem>
                                ))}
                            </MenuList>
                        </Menu>
                    )}

                    <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label="Settings"
                        icon={<MdSettings />}
                        onClick={() => setIsSettingsModalOpen(true)}
                    />

                    <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label="Help"
                        icon={<MdHelp />}
                        onClick={() => setIsAboutModalOpen(true)}
                    />
                </HStack>
            </Flex>

            <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
            <AboutModal isOpen={isAboutModalOpen} onClose={() => setIsAboutModalOpen(false)} />
        </RmgWindowHeader>
    );
}
