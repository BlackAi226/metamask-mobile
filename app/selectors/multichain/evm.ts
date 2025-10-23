/* evm.ts - COMPLETE refactor with raw+derived and default token balances '0x0'
   All imports must remain exactly as before (kept unchanged)
*/
import { createSelector } from 'reselect';
import { Hex, KnownCaipNamespace } from '@metamask/utils';
import { Token, getNativeTokenAddress } from '@metamask/assets-controllers';
import {
  selectSelectedInternalAccountFormattedAddress,
  selectSelectedInternalAccount,
  selectSelectedInternalAccountAddress,
} from '../accountsController';
import { selectAllTokens } from '../tokensController';
import {
  selectAccountBalanceByChainId,
  selectAccountsByChainId,
} from '../accountTrackerController';
import {
  selectChainId,
  selectEvmNetworkConfigurationsByChainId,
  selectEvmTicker,
  selectIsAllNetworks,
  selectIsPopularNetwork,
  selectNetworkConfigurations,
} from '../networkController';
import { TokenI } from '../../components/UI/Tokens/types';
import { renderFromWei, weiToFiat } from '../../util/number';
import {
  hexToBN,
  toChecksumHexAddress,
  toHex,
} from '@metamask/controller-utils';
import {
  selectConversionRate,
  selectCurrencyRates,
  selectCurrentCurrency,
} from '../currencyRateController';
import { createDeepEqualSelector } from '../util';
import { getTicker } from '../../util/transactions';
import { zeroAddress } from 'ethereumjs-util';
import { selectHideZeroBalanceTokens } from '../settings';
import { selectTokensBalances } from '../tokenBalancesController';
import { isZero } from '../../util/lodash';
import { selectIsTokenNetworkFilterEqualCurrentNetwork } from '../preferencesController';
import { selectIsEvmNetworkSelected } from '../multichainNetworkController';
import {
  isTestNet,
  isRemoveGlobalNetworkSelectorEnabled,
} from '../../util/networks';
import { selectTokenMarketData } from '../tokenRatesController';
import { deriveBalanceFromAssetMarketDetails } from '../../components/UI/Tokens/util';
import { RootState } from '../../reducers';
import { selectTokenList } from '../tokenListController';
import { safeToChecksumAddress, toFormattedAddress } from '../../util/address';
import { selectEnabledNetworksByNamespace } from '../networkEnablementController';

interface NativeTokenBalance {
  balance: string;
  stakedBalance: string;
  isStaked: boolean;
  name: string;
}

type ChainBalances = Record<string, NativeTokenBalance>;

type RawDerived<T> = {
  raw: T | null;
  derived: T | null;
};

/**
 * Important :
 * - Tous les selectors retournent { raw, derived } (ou { raw, derived: null } quand inutilisable)
 * - raw = données brutes issues du store (non transformées)
 * - derived = version transformée pour l'UI (formatter/balances/fiat)
 *
 * Pour chaque token absent on injecte balance '0x0' (store par défaut pour comptes neufs).
 */

/* Helper to ensure token raw balance presence */
function ensureTokenBalanceHex(balance?: string | null | undefined): string {
  if (!balance) return '0x0';
  return balance;
}

/**
 * selectedAccountNativeTokenCachedBalanceByChainIdForAddress
 */
export const selectedAccountNativeTokenCachedBalanceByChainIdForAddress =
  createSelector(
    [
      selectAccountsByChainId,
      (_: RootState, address: string | undefined) => address,
    ],
    (accountsByChainId, address): RawDerived<ChainBalances> => {
      // raw: values straight from the controller, but normalized so every chain key exists and has hex balances
      if (!accountsByChainId || !address) {
        const rawEmpty: ChainBalances = {};
        console.log(
          '[evm.ts] selectedAccountNativeTokenCachedBalanceByChainIdForAddress - raw (empty)',
          rawEmpty,
        );
        return { raw: rawEmpty, derived: rawEmpty };
      }

      const checksumAddress = toChecksumHexAddress(address);
      const raw: ChainBalances = {};

      for (const chainId in accountsByChainId) {
        const accounts = accountsByChainId[chainId];
        const account = accounts[checksumAddress];
        if (account) {
          raw[chainId] = {
            balance: ensureTokenBalanceHex(account.balance),
            stakedBalance: ensureTokenBalanceHex(account.stakedBalance),
            isStaked:
              typeof account.stakedBalance !== 'undefined' &&
              account.stakedBalance !== null &&
              account.stakedBalance !== '0x0',
            name: account.name ?? '',
          };
        } else {
          // default for newly created/unsynced accounts
          raw[chainId] = {
            balance: '0x0',
            stakedBalance: '0x0',
            isStaked: false,
            name: '',
          };
        }
      }

      console.log(
        '[evm.ts] selectedAccountNativeTokenCachedBalanceByChainIdForAddress - raw',
        raw,
      );

      // derived = same shape, kept hex balances for further using selectors
      const derived: ChainBalances = { ...raw };

      return { raw, derived };
    },
  );

/**
 * selectedAccountNativeTokenCachedBalanceByChainId (wrapper)
 */
export const selectedAccountNativeTokenCachedBalanceByChainId = createSelector(
  [(state: RootState) => state, selectSelectedInternalAccountFormattedAddress],
  (state, selectedAddress) =>
    selectedAccountNativeTokenCachedBalanceByChainIdForAddress(
      state,
      selectedAddress,
    ),
);

/**
 * selectNativeTokensAcrossChainsForAddress
 * -> raw contains networkConfigurations + nativeTokenBalancesByChainId (raw) + currencyRates + currentCurrency
 * -> derived contains the tokensByChain ready for UI (balances formatted, fiat, logo, isNative, isStaked)
 */
export const selectNativeTokensAcrossChainsForAddress = createSelector(
  [
    selectEvmNetworkConfigurationsByChainId,
    (state: RootState, address: string | undefined) =>
      selectedAccountNativeTokenCachedBalanceByChainIdForAddress(
        state,
        address,
      ),
    selectCurrencyRates,
    selectCurrentCurrency,
  ],
  (
    networkConfigurations,
    nativeTokenBalancesByChainIdWrapper,
    currencyRates,
    currentCurrency,
  ): RawDerived<Record<string, TokenI[]>> => {
    const raw = {
      networkConfigurations,
      nativeTokenBalancesByChainIdRaw: nativeTokenBalancesByChainIdWrapper?.raw ?? {},
      currencyRates,
      currentCurrency,
    };

    console.log('[evm.ts] selectNativeTokensAcrossChainsForAddress - raw', raw);

    // derived
    const tokensByChain: { [chainId: string]: TokenI[] } = {};

    for (const tokenCfg of Object.values(networkConfigurations)) {
      const nativeChainId = tokenCfg.chainId as Hex;
      const nativeTokenInfoByChainId =
        (nativeTokenBalancesByChainIdWrapper?.raw ?? {})[nativeChainId] ?? {
          balance: '0x0',
          stakedBalance: '0x0',
          isStaked: false,
          name: '',
        };

      const isETH = [
        'ETH',
        'GOETH',
        'SepoliaETH',
        'LineaETH',
        'MegaETH',
      ].includes(tokenCfg.nativeCurrency || '');

      const name = isETH ? 'Ethereum' : tokenCfg.nativeCurrency;
      const logo = isETH ? '../images/eth-logo-new.png' : '';
      tokensByChain[nativeChainId] = [];

      const nativeBalanceFormatted = renderFromWei(
        ensureTokenBalanceHex(nativeTokenInfoByChainId.balance),
      );
      const stakedBalanceFormatted = renderFromWei(
        ensureTokenBalanceHex(nativeTokenInfoByChainId.stakedBalance),
      );

      const conversionRate =
        currencyRates?.[tokenCfg.nativeCurrency]?.conversionRate ?? 0;

      const balanceFiat = weiToFiat(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hexToBN(ensureTokenBalanceHex(nativeTokenInfoByChainId.balance)) as any,
        conversionRate,
        currentCurrency,
      );
      const stakedBalanceFiat = weiToFiat(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hexToBN(ensureTokenBalanceHex(nativeTokenInfoByChainId.stakedBalance)) as any,
        conversionRate,
        currentCurrency,
      );

      const tokenByChain: TokenI & any = {
        ...nativeTokenInfoByChainId,
        name,
        address: getNativeTokenAddress(nativeChainId),
        balance: nativeBalanceFormatted ?? '0',
        chainId: nativeChainId,
        isNative: true,
        aggregators: [],
        balanceFiat,
        image: '',
        logo,
        isETH,
        decimals: 18,
        symbol: name,
        isStaked: false,
        ticker: tokenCfg.nativeCurrency,
      };

      tokensByChain[nativeChainId].push(tokenByChain);

      if (
        nativeTokenInfoByChainId &&
        nativeTokenInfoByChainId.isStaked &&
        nativeTokenInfoByChainId.stakedBalance !== '0x00' &&
        nativeTokenInfoByChainId.stakedBalance !== toHex(0) &&
        nativeTokenInfoByChainId.stakedBalance !== '0'
      ) {
        tokensByChain[nativeChainId].push({
          ...nativeTokenInfoByChainId,
          nativeAsset: tokenByChain,
          chainId: nativeChainId,
          address: getNativeTokenAddress(nativeChainId),
          balance: stakedBalanceFormatted ?? '0',
          balanceFiat: stakedBalanceFiat,
          isNative: true,
          aggregators: [],
          image: '',
          logo,
          isETH,
          decimals: 18,
          name: 'Staked Ethereum',
          symbol: name,
          isStaked: true,
          ticker: tokenCfg.nativeCurrency,
        });
      }
    }

    return { raw, derived: tokensByChain };
  },
);

/**
 * selectNativeTokensAcrossChains (wrapper)
 */
export const selectNativeTokensAcrossChains = createSelector(
  [(state: RootState) => state, selectSelectedInternalAccountFormattedAddress],
  (state, selectedAddress) =>
    selectNativeTokensAcrossChainsForAddress(state, selectedAddress),
);

/**
 * selectAccountTokensAcrossChainsForAddress
 * Combines native tokens (from native selector) + non-native tokens (from tokensController)
 * raw includes allTokens + networkConfigurations + nativeTokens raw + address
 * derived is tokensByChain ready for UI; non-native default balance is '0x0' when missing
 */
export const selectAccountTokensAcrossChainsForAddress =
  createDeepEqualSelector(
    selectAllTokens,
    selectEvmNetworkConfigurationsByChainId,
    (state: RootState, address: string | undefined) =>
      selectNativeTokensAcrossChainsForAddress(state, address),
    (_: RootState, address: string | undefined) => address,
    (
      allTokens,
      networkConfigurations,
      nativeTokensWrapper,
      address,
    ): RawDerived<Record<string, (TokenI | (Token & { isStaked?: boolean; isNative?: boolean; isETH?: boolean }))[]>> => {
      const raw = {
        allTokens,
        networkConfigurations,
        nativeTokensRaw: nativeTokensWrapper?.raw ?? {},
        address,
      };

      console.log('[evm.ts] selectAccountTokensAcrossChainsForAddress - raw', raw);

      const tokensByChain: {
        [chainId: string]: (
          | TokenI
          | (Token & {
              isStaked?: boolean;
              isNative?: boolean;
              isETH?: boolean;
            })
        )[];
      } = {};

      if (!address) {
        return { raw, derived: tokensByChain };
      }

      const chainIds = Object.keys(networkConfigurations);
      for (const chainId of chainIds) {
        const currentChainId = chainId as Hex;

        // raw non-native tokens as stored in allTokens (could be undefined)
        const rawNonNativeList =
          allTokens?.[currentChainId]?.[address] ?? [];

        // ensure every raw token has balance hex
        const rawNonNativeWithDefaults = rawNonNativeList.map((token) => ({
          ...token,
          balance: ensureTokenBalanceHex((token as any).balance),
        }));

        // derived non native tokens for UI
        const nonNativeTokens = rawNonNativeWithDefaults.map((token) => ({
          ...token,
          token: (token as any).name,
          chainId,
          isETH: false,
          isNative: false,
          balanceFiat: '',
          isStaked: false,
          balance:
            typeof (token as any).balance === 'string' &&
            (token as any).balance.startsWith('0x')
              ? renderFromWei((token as any).balance)
              : (token as any).balance ?? '0',
        })) as unknown as (
          | TokenI
          | (Token & {
              isStaked?: boolean;
              isNative?: boolean;
              isETH?: boolean;
            })
        )[];

        // derived native tokens from nativeTokensWrapper.derived
        const derivedNativeTokens =
          (nativeTokensWrapper?.derived as any)?.[currentChainId] || [];

        tokensByChain[currentChainId] = [
          ...(derivedNativeTokens || []),
          ...nonNativeTokens,
        ];
      }

      return { raw, derived: tokensByChain };
    },
  );

/**
 * selectAccountTokensAcrossChains (wrapper)
 */
export const selectAccountTokensAcrossChains = createSelector(
  (state: RootState) => state,
  selectSelectedInternalAccount,
  (state, selectedAccount) => {
    const selectedAddress = selectedAccount?.address;
    return selectAccountTokensAcrossChainsForAddress(state, selectedAddress);
  },
);

/**
 * selectNativeEvmAsset
 * raw contains accountBalanceByChainId + ticker + conversionRate + currency
 * derived is the formatted native asset
 */
export const selectNativeEvmAsset = createDeepEqualSelector(
  selectAccountBalanceByChainId,
  selectEvmTicker,
  selectConversionRate,
  selectCurrentCurrency,
  (accountBalanceByChainId, ticker, conversionRate, currentCurrency): RawDerived<any> => {
    const raw = { accountBalanceByChainId, ticker, conversionRate, currentCurrency };

    console.log('[evm.ts] selectNativeEvmAsset - raw', raw);

    if (!accountBalanceByChainId) {
      return { raw, derived: undefined };
    }

    const derived = {
      decimals: 18,
      name: getTicker(ticker) === 'ETH' ? 'Ethereum' : ticker,
      symbol: getTicker(ticker),
      isETH: true,
      balance: renderFromWei(ensureTokenBalanceHex(accountBalanceByChainId.balance)),
      balanceFiat: weiToFiat(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hexToBN(ensureTokenBalanceHex(accountBalanceByChainId.balance)) as any,
        conversionRate,
        currentCurrency,
      ),
      logo: '../images/eth-logo-new.png',
      address: zeroAddress(),
    };

    return { raw, derived };
  },
);

/**
 * selectStakedEvmAsset
 */
export const selectStakedEvmAsset = createDeepEqualSelector(
  selectAccountBalanceByChainId,
  selectConversionRate,
  selectCurrentCurrency,
  selectNativeEvmAsset,
  (accountBalanceByChainId, conversionRate, currentCurrency, nativeAssetWrapper): RawDerived<any> => {
    const raw = {
      accountBalanceByChainId,
      conversionRate,
      currentCurrency,
      nativeAssetRaw: nativeAssetWrapper?.raw,
    };

    console.log('[evm.ts] selectStakedEvmAsset - raw', raw);

    if (!accountBalanceByChainId) {
      return { raw, derived: undefined };
    }
    if (!accountBalanceByChainId.stakedBalance) {
      return { raw, derived: undefined };
    }
    if (hexToBN(accountBalanceByChainId.stakedBalance).isZero()) {
      return { raw, derived: undefined };
    }
    if (!nativeAssetWrapper?.derived) {
      return { raw, derived: undefined };
    }

    const derived = {
      ...nativeAssetWrapper.derived,
      name: 'Staked Ethereum',
      isStaked: true,
      balance: renderFromWei(ensureTokenBalanceHex(accountBalanceByChainId.stakedBalance)),
      balanceFiat: weiToFiat(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hexToBN(ensureTokenBalanceHex(accountBalanceByChainId.stakedBalance)) as any,
        conversionRate,
        currentCurrency,
      ),
    };

    return { raw, derived };
  },
);

/**
 * selectEvmTokensWithZeroBalanceFilter
 */
export const selectEvmTokensWithZeroBalanceFilter = createDeepEqualSelector(
  selectHideZeroBalanceTokens,
  selectAccountTokensAcrossChains,
  selectTokensBalances,
  selectSelectedInternalAccountAddress,
  selectIsTokenNetworkFilterEqualCurrentNetwork,
  (
    hideZeroBalanceTokens,
    selectedAccountTokensChainsWrapper,
    multiChainTokenBalance,
    selectedInternalAccountAddress,
    isUserOnCurrentNetwork,
  ): RawDerived<TokenI[] | null> => {
    const raw = {
      hideZeroBalanceTokens,
      selectedAccountTokensChainsRaw: selectedAccountTokensChainsWrapper?.raw,
      selectedAccountTokensChainsDerived: selectedAccountTokensChainsWrapper?.derived,
      multiChainTokenBalance,
      selectedInternalAccountAddress,
      isUserOnCurrentNetwork,
    };

    console.log('[evm.ts] selectEvmTokensWithZeroBalanceFilter - raw', raw);

    const allTokens = Object.values(
      selectedAccountTokensChainsWrapper?.derived || {},
    ).flat() as TokenI[];

    let tokensToDisplay: TokenI[] = allTokens;

    if (hideZeroBalanceTokens) {
      tokensToDisplay = allTokens.filter((token) => {
        const multiChainTokenBalances =
          multiChainTokenBalance?.[selectedInternalAccountAddress as Hex]?.[
            token.chainId as Hex
          ];
        const balance =
          multiChainTokenBalances?.[token.address as Hex] ?? token.balance;

        // ensure balanceToCheck is a string or numeric that is understood by isZero
        const balanceToCheck =
          balance === undefined || balance === null ? '0' : balance;

        return (
          !isZero(balanceToCheck) ||
          (isUserOnCurrentNetwork && (token.isNative || token.isStaked))
        );
      });
    }

    const derived = tokensToDisplay;

    return { raw, derived };
  },
);

/**
 * selectEvmTokens
 */
export const selectEvmTokens = createDeepEqualSelector(
  selectEvmTokensWithZeroBalanceFilter,
  selectIsAllNetworks,
  selectIsPopularNetwork,
  selectIsEvmNetworkSelected,
  selectChainId,
  selectEnabledNetworksByNamespace,
  (
    tokensToDisplayWrapper,
    isAllNetworks,
    isPopularNetwork,
    isEvmSelected,
    currentChainId,
    enabledNetworksByNamespace,
  ): RawDerived<TokenI[] | null> => {
    const raw = {
      tokensToDisplayRaw: tokensToDisplayWrapper?.raw,
      tokensToDisplayDerived: tokensToDisplayWrapper?.derived,
      isAllNetworks,
      isPopularNetwork,
      isEvmSelected,
      currentChainId,
      enabledNetworksByNamespace,
    };

    console.log('[evm.ts] selectEvmTokens - raw', raw);

    const tokensToDisplay = tokensToDisplayWrapper?.derived || [];

    let filteredTokens: TokenI[];
    if (isRemoveGlobalNetworkSelectorEnabled()) {
      const enabledEip155Networks =
        enabledNetworksByNamespace?.[KnownCaipNamespace.Eip155];

      if (!enabledEip155Networks) {
        filteredTokens =
          isAllNetworks && isPopularNetwork && isEvmSelected
            ? tokensToDisplay
            : (tokensToDisplay as TokenI[]).filter(
                (token: TokenI) => token.chainId === currentChainId,
              );
      } else {
        filteredTokens = (tokensToDisplay as TokenI[]).filter(
          (currentToken: TokenI) => {
            const chainId = currentToken.chainId || '';
            return enabledEip155Networks[chainId as Hex];
          },
        );
      }
    } else {
      filteredTokens =
        isAllNetworks && isPopularNetwork && isEvmSelected
          ? tokensToDisplay
          : (tokensToDisplay as TokenI[]).filter(
              (token: TokenI) => token.chainId === currentChainId,
            );
    }

    const nativeTokens: TokenI[] = [];
    const nonNativeTokens: TokenI[] = [];

    for (const currToken of filteredTokens) {
      const token = currToken as TokenI & { chainId: string };

      if (
        isTestNet(token.chainId) &&
        !isTestNet(currentChainId) &&
        !isRemoveGlobalNetworkSelectorEnabled()
      ) {
        continue;
      }

      if (token.isNative) {
        nativeTokens.push(token);
      } else {
        nonNativeTokens.push(token);
      }
    }

    const derived = [...nativeTokens, ...nonNativeTokens];

    return { raw, derived };
  },
);

/**
 * selectEvmToke
