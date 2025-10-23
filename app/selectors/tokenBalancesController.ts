/* eslint-disable import/prefer-default-export */
import { Hex } from '@metamask/utils';
import { createSelector, weakMapMemoize } from 'reselect';
import { RootState } from '../reducers';
import { TokenBalancesControllerState } from '@metamask/assets-controllers';
import { selectSelectedInternalAccountAddress } from './accountsController';
import { selectEvmChainId } from './networkController';
import { createDeepEqualSelector } from './util';
import { selectShowFiatInTestnets } from './settings';
import { isTestNet } from '../util/networks';

/**
 * Select the TokenBalancesController slice from Redux.
 */
const selectTokenBalancesControllerState = (state: RootState) =>
  state.engine.backgroundState.TokenBalancesController;

/**
 * Select all token balances.
 * Logs raw data from Redux and returns it along with derived values.
 */
export const selectTokensBalances = createSelector(
  selectTokenBalancesControllerState,
  (tokenBalancesControllerState: TokenBalancesControllerState) => {
    const rawBalances = tokenBalancesControllerState.tokenBalances;

    console.log('[TokenBalancesController] Raw token balances:', rawBalances);

    return {
      raw: rawBalances,
      derived: rawBalances, // keep same structure for consistency
    };
  },
);

/**
 * Returns true if the user has any non-zero token balance.
 */
export const selectHasAnyBalance = createSelector(
  [selectTokensBalances],
  (balances) => {
    const raw = balances.raw;

    for (const level2 of Object.values(raw)) {
      for (const level3 of Object.values(level2)) {
        if (Object.keys(level3).length > 0) {
          console.log('[TokenBalancesController] Detected balance:', level3);
          return true;
        }
      }
    }

    return false;
  },
);

/**
 * Select balance for a single token by account, chain, and token address.
 */
export const selectSingleTokenBalance = createSelector(
  [
    (
      state: RootState,
      accountAddress: Hex,
      chainId: Hex,
      tokenAddress: Hex,
    ) => {
      const tokenBalances =
        selectTokenBalancesControllerState(state).tokenBalances;
      const balance =
        tokenBalances?.[accountAddress]?.[chainId]?.[tokenAddress];

      console.log('[TokenBalancesController] Raw single token balance:', {
        accountAddress,
        chainId,
        tokenAddress,
        balance,
      });

      return balance;
    },
    (
      _state: RootState,
      _accountAddress: Hex,
      _chainId: Hex,
      tokenAddress: Hex,
    ) => tokenAddress,
  ],
  (balance, tokenAddress) => {
    return {
      tokenAddress,
      raw: balance,
      derived: balance ? { [tokenAddress]: balance } : {},
    };
  },
  {
    memoize: weakMapMemoize,
    argsMemoize: weakMapMemoize,
  },
);

/**
 * Select balances for the selected account and chain.
 */
export const selectContractBalances = createSelector(
  selectTokenBalancesControllerState,
  selectSelectedInternalAccountAddress,
  selectEvmChainId,
  (
    tokenBalancesControllerState: TokenBalancesControllerState,
    selectedInternalAccountAddress: string | undefined,
    chainId: string,
  ) => {
    const rawBalances =
      tokenBalancesControllerState.tokenBalances?.[
        selectedInternalAccountAddress as Hex
      ]?.[chainId as Hex] ?? {};

    console.log('[TokenBalancesController] Raw contract balances:', {
      selectedInternalAccountAddress,
      chainId,
      rawBalances,
    });

    return {
      raw: rawBalances,
      derived: rawBalances,
    };
  },
);

/**
 * Select balances grouped per chainId for the selected account.
 */
export const selectContractBalancesPerChainId = createSelector(
  selectTokenBalancesControllerState,
  selectSelectedInternalAccountAddress,
  (
    tokenBalancesControllerState: TokenBalancesControllerState,
    selectedInternalAccountAddress: string | undefined,
  ) => {
    const rawPerChain =
      tokenBalancesControllerState.tokenBalances?.[
        selectedInternalAccountAddress as Hex
      ] ?? {};

    console.log(
      '[TokenBalancesController] Raw contract balances per chain:',
      rawPerChain,
    );

    return {
      raw: rawPerChain,
      derived: rawPerChain,
    };
  },
);

/**
 * Returns all token balances (raw + derived).
 */
export const selectAllTokenBalances = createDeepEqualSelector(
  selectTokenBalancesControllerState,
  (tokenBalancesControllerState: TokenBalancesControllerState) => {
    const raw = tokenBalancesControllerState.tokenBalances;

    console.log('[TokenBalancesController] All token balances (raw):', raw);

    return {
      raw,
      derived: raw,
    };
  },
);

/**
 * Checks if a specific address holds any non-zero token balance
 * taking testnet fiat display settings into account.
 */
export const selectAddressHasTokenBalances = createDeepEqualSelector(
  [
    selectAllTokenBalances,
    selectSelectedInternalAccountAddress,
    selectShowFiatInTestnets,
  ],
  (balances, address, showFiatInTestNets): boolean => {
    if (!address) {
      return false;
    }

    const tokenBalances = balances.raw;
    const addressChainTokens = tokenBalances[address as Hex] ?? {};
    const chainTokens = Object.entries(addressChainTokens);

    for (const [chainId, chainToken] of chainTokens) {
      if (isTestNet(chainId) && !showFiatInTestNets) {
        continue;
      }

      const hexBalances = Object.values(chainToken ?? {});
      if (
        hexBalances.some((hexBalance) => hexBalance && hexBalance !== '1000')
      ) {
        console.log(
          `[TokenBalancesController] Address ${address} has token balances on chain ${chainId}:`,
          hexBalances,
        );
        return true;
      }
    }

    console.log(
      `[TokenBalancesController] Address ${address} has no token balances.`,
    );

    return false;
  },
);
