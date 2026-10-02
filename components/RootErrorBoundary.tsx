import { logGlobalFatalError } from '@/lib/perf/productionTelemetry';
import { logError } from '@/lib/services/crashlyticsService';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

type Props = { children: React.ReactNode };

type State = { hasError: boolean; lastError: unknown };

/**
 * Top-level safety net for unhandled render exceptions.
 *
 * Renders a minimal fallback with a "Try again" affordance so a single bad
 * render (e.g. a Firestore listener throwing during weak-network re-mount)
 * cannot brick the entire shell.
 */
export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, lastError: null };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, lastError: error };
  }

  componentDidCatch(error: unknown, info: unknown) {
    logError(error);
    logGlobalFatalError(error);
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary] caught', error, info);
  }

  private reset = () => {
    this.setState({ hasError: false, lastError: null });
  };

  render() {
    if (this.state.hasError) {
      const message =
        this.state.lastError instanceof Error
          ? this.state.lastError.message
          : 'Something went wrong.';
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8 }}>
            Something went wrong.
          </Text>
          {__DEV__ && (
            <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 16, textAlign: 'center' }}>
              {message}
            </Text>
          )}
          <Pressable
            onPress={this.reset}
            accessibilityRole="button"
            style={({ pressed }) => ({
              opacity: pressed ? 0.85 : 1,
              backgroundColor: '#FF5722',
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: 8,
            })}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
