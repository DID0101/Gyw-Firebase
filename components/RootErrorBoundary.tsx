import React from 'react';
import { Text, View } from 'react-native';

type Props = { children: React.ReactNode };

type State = { hasError: boolean };

/**
 * Catch root render crashes so we can capture `componentStack` and unblock
 * debugging. Intentionally renders minimal fallback UI.
 */
export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(_error: unknown): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary] caught', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text>Something went wrong.</Text>
        </View>
      );
    }

    return this.props.children;
  }
}

