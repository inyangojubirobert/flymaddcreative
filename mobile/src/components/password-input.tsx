import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Palette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function PasswordInput({ placeholder = 'Password', style, ...props }: Omit<TextInputProps, 'secureTextEntry'>) {
  const theme = useTheme();
  const [isVisible, setIsVisible] = useState(false);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <TextInput
        {...props}
        placeholder={placeholder}
        placeholderTextColor={props.placeholderTextColor ?? theme.textSecondary}
        secureTextEntry={!isVisible}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: theme.text }, style]}
      />
      <Pressable
        onPress={() => setIsVisible((visible) => !visible)}
        style={({ pressed }) => [styles.eyeButton, pressed && styles.eyePressed]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={isVisible ? 'Hide password' : 'Show password'}
        accessibilityState={{ expanded: isVisible }}
      >
        <Ionicons name={isVisible ? 'eye-off-outline' : 'eye-outline'} size={22} color={Palette.slate} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingLeft: 16,
    paddingVertical: 13,
  },
  eyeButton: {
    width: 50,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyePressed: { backgroundColor: Palette.ashSoft },
});
