import { Pressable, type PressableProps, ViewStyle } from 'react-native';

export function CallButton(props: PressableProps & { bg: string }) {
  const { bg, style, disabled, ...rest } = props;
  return (
    <Pressable
      disabled={disabled}
      {...rest}
      style={({ pressed }) => {
        const base: ViewStyle = {
          width: 70,
          height: 70,
          borderRadius: 35,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 10,
          opacity: pressed && !disabled ? 0.7 : 1,
        };

        const extra = typeof style === 'function' ? style({ pressed }) : style;
        return [base, extra] as any;
      }}
    />
  );
}

