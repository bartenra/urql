import React, { createElement, useState } from 'react';
import ssrPrepass from 'react-ssr-prepass';

import {
  Provider,
  ssrExchange,
  dedupExchange,
  cacheExchange,
  fetchExchange,
} from 'urql';

import { initUrqlClient, resetClient } from './init-urql-client';

import {
  NextUrqlClientConfig,
  NextUrqlContext,
  WithUrqlProps,
  WithUrqlClientOptions,
  NextComponentType,
  SSRExchange,
  NextUrqlPageContext,
} from './types';

let ssr: SSRExchange;

export function withUrqlClient(
  getClientConfig: NextUrqlClientConfig,
  options?: WithUrqlClientOptions
) {
  if (!options) options = {};

  return <C extends NextComponentType = NextComponentType>(
    AppOrPage: C
  ): NextComponentType => {
    const shouldEnableSuspense = Boolean(
      (AppOrPage.getInitialProps || options!.ssr) && !options!.neverSuspend
    );

    const WithUrql = ({
      pageProps,
      urqlClient,
      urqlState,
      ...rest
    }: WithUrqlProps) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const forceUpdate = useState(0);
      const urqlServerState = (pageProps && pageProps.urqlState) || urqlState;

      // eslint-disable-next-line react-hooks/rules-of-hooks
      const client = React.useMemo(() => {
        if (urqlClient) {
          return urqlClient;
        }

        if (!ssr || typeof window === 'undefined') {
          // We want to force the cache to hydrate, we do this by setting the isClient flag to true
          ssr = ssrExchange({ initialState: urqlServerState, isClient: true });
        } else if (ssr && typeof window !== 'undefined') {
          ssr.restoreData(urqlServerState);
        }

        const clientConfig = getClientConfig(ssr);
        if (!clientConfig.exchanges) {
          // When the user does not provide exchanges we make the default assumption.
          clientConfig.exchanges = [
            dedupExchange,
            cacheExchange,
            ssr,
            fetchExchange,
          ];
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return initUrqlClient(clientConfig, shouldEnableSuspense)!;
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [urqlClient, urqlServerState, forceUpdate[0]]);

      const resetUrqlClient = () => {
        resetClient();
        ssr = ssrExchange({ initialState: undefined });
        forceUpdate[1](forceUpdate[0] + 1);
      };

      return createElement(
        Provider,
        { value: client },
        createElement(AppOrPage, {
          ...rest,
          pageProps,
          urqlClient: client,
          resetUrqlClient,
        })
      );
    };

    // Set the displayName to indicate use of withUrqlClient.
    const displayName = AppOrPage.displayName || AppOrPage.name || 'Component';
    WithUrql.displayName = `withUrqlClient(${displayName})`;

    if (AppOrPage.getInitialProps || options!.ssr) {
      WithUrql.getInitialProps = async (appOrPageCtx: NextUrqlPageContext) => {
        const AppTree = appOrPageCtx.AppTree!;

        // Determine if we are wrapping an App component or a Page component.
        const isApp = !!appOrPageCtx.Component;
        const ctx = isApp ? appOrPageCtx.ctx! : appOrPageCtx;

        const ssrCache = ssrExchange({ initialState: undefined });
        const clientConfig = getClientConfig(ssrCache, ctx);
        if (!clientConfig.exchanges) {
          // When the user does not provide exchanges we make the default assumption.
          clientConfig.exchanges = [
            dedupExchange,
            cacheExchange,
            ssrCache,
            fetchExchange,
          ];
        }

        const urqlClient = initUrqlClient(clientConfig, !options!.neverSuspend);

        if (urqlClient) {
          (ctx as NextUrqlContext).urqlClient = urqlClient;
        }

        // Run the wrapped component's getInitialProps function.
        let pageProps = {} as any;
        if (AppOrPage.getInitialProps) {
          pageProps = await AppOrPage.getInitialProps(
            appOrPageCtx as NextUrqlPageContext
          );
        }

        // Check the window object to determine whether or not we are on the server.
        // getInitialProps runs on the server for initial render, and on the client for navigation.
        // We only want to run the prepass step on the server.
        if (typeof window !== 'undefined') {
          return { ...pageProps, urqlClient };
        }

        const props = { ...pageProps, urqlClient };
        const appTreeProps = isApp ? props : { pageProps: props };

        // Run the prepass step on AppTree. This will run all urql queries on the server.
        if (!options!.neverSuspend) {
          await ssrPrepass(createElement(AppTree, appTreeProps));
        }

        return {
          ...pageProps,
          urqlState: ssrCache ? ssrCache.extractData() : undefined,
          urqlClient,
        };
      };
    }

    return WithUrql;
  };
}
