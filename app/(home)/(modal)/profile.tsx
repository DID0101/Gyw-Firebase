import { useClerk, useUser } from '@clerk/clerk-expo';
import clsx from 'clsx';
import { ImagePickerAsset } from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TextInput, View } from 'react-native';
import { useChatContext } from 'stream-chat-expo';

import Button from '@/components/Button';
import ImageInput from '@/components/ImageInput';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import useUserForm from '@/hooks/useUserForm';
import { getError } from '@/lib/utils';

const ProfileScreen = () => {
  const { user } = useUser();
  const { client } = useChatContext();
  const clerk = useClerk();
  const { t } = useTranslation();
  const streamUser = client.user;
  // Get username from Stream Chat (not Clerk, since username isn't enabled in Clerk)
  const streamUsername = (streamUser as any)?.username || '';
  const usernameParts = streamUsername ? streamUsername.split('_') : ['', ''];
  const initialFormValues = {
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    username: usernameParts[0] ?? '',
    usernameNumber: usernameParts[1] ?? '',
    phoneNumber: (streamUser as any)?.phone || user?.primaryPhoneNumber?.phoneNumber || '',
    emailAddress: (streamUser as any)?.email || user?.primaryEmailAddress?.emailAddress || '',
  };
  const defaultImage: ImagePickerAsset = {
    uri: user?.hasImage ? user?.imageUrl : '',
    width: 100,
    height: 100,
  };

  const {
    firstName,
    lastName,
    username,
    usernameNumber,
    numberError,
    phoneNumber,
    emailAddress,
    onChangeFirstName,
    onChangeLastName,
    onChangeUsername,
    onChangeNumber,
    onChangePhoneNumber,
    onChangeEmailAddress,
  } = useUserForm(initialFormValues);
  const [profileImage, setProfileImage] =
    useState<ImagePickerAsset>(defaultImage);
  const [loading, setLoading] = useState(false);
  const [savedUsername, setSavedUsername] = useState<string>('');

  // Update saved username when Stream Chat user data is available
  useEffect(() => {
    const streamUsername = (streamUser as any)?.username || '';
    if (streamUsername) {
      setSavedUsername(streamUsername);
    }
  }, [streamUser]);

  const submitDisabled =
    loading || !username || !usernameNumber || !firstName || !lastName;

  const updateProfile = async () => {
    try {
      setLoading(true);
      const finalUsername = `${username}_${usernameNumber}`;
      // Only update firstName and lastName (username not enabled in Clerk)
      const result = await user?.update({
        firstName,
        lastName,
      });
      // Update Stream Chat user with username, phone, and email
      await client.upsertUser({
        id: result?.id!,
        name: result?.fullName!,
        username: finalUsername,
        ...(phoneNumber && { phone: phoneNumber }),
        ...(emailAddress && { email: emailAddress.toLowerCase() }),
      } as any);

      // Update saved username for immediate display
      setSavedUsername(finalUsername);

      // Refresh the user data to reflect changes
      await client.queryUsers({ id: { $eq: result?.id! } });

      const updateUserImage = async (data: string | null) => {
        try {
          const imageResult = await clerk.user?.setProfileImage({
            file: data,
          });
          await client.upsertUser({
            id: result?.id!,
            image: imageResult ? imageResult.publicUrl! : undefined,
            username: finalUsername,
            ...(phoneNumber && { phone: phoneNumber }),
            ...(emailAddress && { email: emailAddress.toLowerCase() }),
          } as any);
          // Refresh user data again after image update
          await client.queryUsers({ id: { $eq: result?.id! } });
        } catch (error) {
          console.error('Error updating user image:', error);
        }
      };

      if (profileImage.uri) {
        const response = await fetch(profileImage.uri);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64data = reader.result as string;
          await updateUserImage(base64data);
        };
      } else {
        await updateUserImage(null);
      }

      alert(t('profile.profileUpdated'));
    } catch (error) {
      getError(error);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      viewClassName="flex-1 pt-3 px-2 sm:px-4 items-center gap-4 sm:gap-6"
      loadingOverlay={loading}
    >
      <View className="items-center gap-3">
        <ImageInput
          name={user?.fullName!}
          imageUri={profileImage.uri}
          onChangeImage={(asset) =>
            setProfileImage(asset ?? { ...defaultImage, uri: '' })
          }
        />
        <Text className="text-sm text-gray-400">
          {savedUsername || (username && usernameNumber ? `${username}_${usernameNumber}` : t('profile.chooseUsername'))}
        </Text>
      </View>
      <View className="gap-3">
        <TextField
          value={firstName}
          placeholder={t('auth.firstName')}
          onChangeText={onChangeFirstName}
        />
        <TextField
          value={lastName}
          placeholder={t('auth.lastName')}
          onChangeText={onChangeLastName}
        />
        <View className="relative">
          <TextField
            autoCapitalize="none"
            value={username}
            placeholder={t('auth.username')}
            onChangeText={onChangeUsername}
            className="pr-12"
          />
          <View className="absolute right-3 top-3 flex-row gap-2">
            <View className="w-0.5 h-5 bg-gray-300" />
            <TextInput
              keyboardType="number-pad"
              maxLength={2}
              value={usernameNumber}
              onChangeText={onChangeNumber}
              className="w-5 h-5 android:w-8 android:h-12 android:bottom-3.5"
            />
          </View>
          <Text
            className={clsx(
              'pl-2 pt-2 text-xs',
              numberError ? 'text-red-500' : 'text-gray-500'
            )}
          >
            {numberError ||
              t('profile.usernameHint')}
          </Text>
        </View>
        <TextField
          value={phoneNumber}
          placeholder={t('auth.phoneNumber') + ' (e.g., +1234567890)'}
          onChangeText={onChangePhoneNumber}
          keyboardType="phone-pad"
        />
        <TextField
          autoCapitalize="none"
          value={emailAddress}
          placeholder={t('auth.emailAddress')}
          onChangeText={onChangeEmailAddress}
          keyboardType="email-address"
        />
      </View>
      <Button onPress={updateProfile} disabled={submitDisabled}>
        {t('common.save')}
      </Button>
    </Screen>
  );
};

export default ProfileScreen;
