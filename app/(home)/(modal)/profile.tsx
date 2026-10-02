import AsyncStorage from '@react-native-async-storage/async-storage';
import clsx from 'clsx';
import { ImagePickerAsset } from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { deleteUser, updateProfile as updateFirebaseProfile } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '@/components/Button';
import { BlockedAccountsSection } from '@/components/profile/BlockedAccountsSection';
import ImageInput from '@/components/ImageInput';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import ThemeToggle from '@/components/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import useUserForm from '@/hooks/useUserForm';
import { db, storage } from '@/lib/firebase';
import { getUserDocNative, hasNativeFirestore, updateUserDocNative } from '@/lib/firestoreNative';
import { getRnAuth, getRnStorage } from '@/lib/rnFirebase';
import { useThemeClassName } from '@/lib/themeUtils';
import { prepareProfileUpdateFields } from '@/lib/unicodeText';
import { getError } from '@/lib/utils';
import { trackProfileViewed } from '@/lib/services/analyticsService';
import { startPerformanceTrace } from '@/lib/services/performanceService';

const ProfileScreen = () => {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const textSecondaryColor = useThemeClassName('text-gray-400', 'text-gray-500');
  const usernameTextColor = useThemeClassName('text-gray-700', 'text-gray-300');
  
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Get username from Firestore user document
  const usernameParts = userData?.username ? userData.username.split('_') : ['', ''];
  const initialFormValues = {
    firstName: userData?.firstName || user?.displayName?.split(' ')[0] || '',
    lastName: userData?.lastName || user?.displayName?.split(' ').slice(1).join(' ') || '',
    username: usernameParts[0] || '',
    usernameNumber: usernameParts[1] || '',
    phoneNumber: userData?.phoneNumber || user?.phoneNumber || '',
    bio: userData?.bio || '',
  };

  const defaultImage: ImagePickerAsset = {
    uri: user?.photoURL || userData?.avatar || '',
    width: 100,
    height: 100,
  };

  const {
    firstName,
    lastName,
    phoneNumber,
    bio,
    onChangeFirstName,
    onChangeLastName,
    onChangePhoneNumber,
    onChangeBio,
  } = useUserForm(initialFormValues);
  const [profileImage, setProfileImage] = useState<ImagePickerAsset>(defaultImage);
  const [savedUsername, setSavedUsername] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    void trackProfileViewed(user?.uid);
  }, [user?.uid]);

  // Load user data from Firestore
  useEffect(() => {
    const loadUserData = async () => {
      if (!user) return;

      const profileTrace = await startPerformanceTrace('profile_load');
      let traceResult = 'ok';
      try {
        let data: any = null;
        if (Platform.OS !== 'web' && hasNativeFirestore) {
          const raw = await getUserDocNative(user.uid);
          if (raw) data = { uid: raw.id, ...raw };
        } else {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) data = userDoc.data();
        }
        if (data) {
          setUserData(data);
          setSavedUsername(data.username || '');
          const avatarUri = data.avatar || user?.photoURL || '';
          setProfileImage((prev) => ({ ...prev, uri: avatarUri }));
        }
      } catch (error) {
        traceResult = 'error';
        console.error('Error loading user data:', error);
      } finally {
        setLoading(false);
        await profileTrace.stop({ result: traceResult });
      }
    };

    loadUserData();
  }, [user?.uid]);

  // Update saved username when user data is available
  useEffect(() => {
    if (userData?.username) {
      setSavedUsername(userData.username);
    }
  }, [userData]);

  const submitDisabled = loading || !firstName?.trim();

  /** Upload profile image immediately when user selects, or clear when deleted (auto-save) */
  const handleImageSelect = async (asset: ImagePickerAsset | null) => {
    if (!user) return;
    if (!asset?.uri) {
      setProfileImage({ uri: '', width: 100, height: 100 });
      setUploadingImage(true);
      try {
        const emptyAvatar = '';
        if (Platform.OS === 'web') {
          await updateFirebaseProfile(user, { photoURL: '' });
        } else {
          const rnAuth = getRnAuth();
          const nativeUser = rnAuth?.currentUser;
          if (nativeUser?.updateProfile) await nativeUser.updateProfile({ photoURL: '' });
        }
        if (Platform.OS !== 'web' && hasNativeFirestore) {
          await updateUserDocNative(user.uid, { avatar: emptyAvatar, updatedAt: new Date().toISOString() });
        } else {
          await updateDoc(doc(db, 'users', user.uid), { avatar: emptyAvatar, updatedAt: new Date().toISOString() });
        }
        setUserData((prev: any) => (prev ? { ...prev, avatar: emptyAvatar } : prev));
      } catch (error) {
        console.error('Error clearing image:', error);
      } finally {
        setUploadingImage(false);
      }
      return;
    }
    setUploadingImage(true);
    try {
      const { withNetworkSafety } = require('@/lib/safeNetwork');
      const avatarUrl: string = await withNetworkSafety(
        async () => {
          if (Platform.OS !== 'web') {
            const rnStorage = getRnStorage();
            const { ref: rnRef, putFile, getDownloadURL: rnGetDownloadURL } =
              require('@react-native-firebase/storage');
            const storageRef = rnRef(rnStorage, `avatars/${user.uid}/avatar.jpg`);
            await putFile(storageRef, asset.uri);
            return rnGetDownloadURL(storageRef);
          }
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          const imageRef = ref(storage, `avatars/${user.uid}/avatar.jpg`);
          await uploadBytes(imageRef, blob);
          return getDownloadURL(imageRef);
        },
        { label: 'upload_avatar', timeoutMs: 30000, maxAttempts: 3 }
      );
      if (Platform.OS === 'web') {
        await updateFirebaseProfile(user, { photoURL: avatarUrl });
      } else {
        const rnAuth = getRnAuth();
        const nativeUser = rnAuth?.currentUser;
        if (nativeUser?.updateProfile) await nativeUser.updateProfile({ photoURL: avatarUrl });
      }
      if (Platform.OS !== 'web' && hasNativeFirestore) {
        await updateUserDocNative(user.uid, { avatar: avatarUrl, updatedAt: new Date().toISOString() });
      } else {
        await updateDoc(doc(db, 'users', user.uid), { avatar: avatarUrl, updatedAt: new Date().toISOString() });
      }
      setProfileImage({ ...asset, uri: avatarUrl });
      setUserData((prev: any) => (prev ? { ...prev, avatar: avatarUrl } : prev));
    } catch (error) {
      console.error('Error uploading image:', error);
      Alert.alert(t('common.error'), t('profile.errorUpdatingProfile'));
    } finally {
      setUploadingImage(false);
    }
  };

  const updateProfile = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const profileFields = prepareProfileUpdateFields({ firstName, lastName, bio });
      if (Platform.OS === 'web') {
        await updateFirebaseProfile(user, { displayName: profileFields.displayName });
      } else {
        const rnAuth = getRnAuth();
        const nativeUser = rnAuth?.currentUser;
        if (nativeUser?.updateProfile) {
          await nativeUser.updateProfile({ displayName: profileFields.displayName });
        }
      }

      // Update Firestore user document (do NOT include username - immutable after signup)
      const updateData: Record<string, any> = {
        firstName: profileFields.firstName,
        lastName: profileFields.lastName,
        bio: profileFields.bio,
        updatedAt: new Date().toISOString(),
      };
      if (Platform.OS !== 'web' && hasNativeFirestore) {
        await updateUserDocNative(user.uid, updateData);
      } else {
        await updateDoc(doc(db, 'users', user.uid), updateData);
      }

      setUserData((prev: any) => ({
        ...prev,
        firstName: profileFields.firstName,
        lastName: profileFields.lastName,
        bio: profileFields.bio,
      }));

      Alert.alert(t('common.success'), t('profile.profileUpdated'));
    } catch (error) {
      getError(error);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('profile.deleteAccount'),
      t('profile.confirmDeleteAccount'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('profile.deleteAccount'),
          style: 'destructive',
          onPress: deleteAccount,
        },
      ],
      { cancelable: true }
    );
  };

  const deleteAccount = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      
      // Clear all local storage
      try {
        await AsyncStorage.clear();
        console.log('Local storage cleared');
      } catch (storageError) {
        console.error('Error clearing storage:', storageError);
      }

      // Delete user from Firestore (mark as deleted rather than actually deleting)
      const deleteData = { deleted: true, deletedAt: new Date().toISOString() };
      if (Platform.OS !== 'web' && hasNativeFirestore) {
        await updateUserDocNative(user.uid, deleteData);
      } else {
        await updateDoc(doc(db, 'users', user.uid), deleteData);
      }

      // Delete Firebase Auth account
      try {
        if (Platform.OS === 'web') {
          await deleteUser(user);
        } else {
          const rnAuth = getRnAuth();
          const nativeUser = rnAuth?.currentUser;
          if (nativeUser?.delete) await nativeUser.delete();
        }
        console.log('Account deleted from Firebase');
      } catch (error: any) {
        console.error('Error deleting from Firebase:', error);
        // If deletion fails, sign out instead
        await signOut();
      }

      // Navigate to sign-in screen
      router.replace('/(auth)/sign-in');
    } catch (error) {
      console.error('Error deleting account:', error);
      Alert.alert(
        t('common.error'),
        t('profile.errorDeletingAccount'),
        [{ text: t('common.ok') }]
      );
    } finally {
      setLoading(false);
    }
  };

  if (loading && !userData) {
    return <Screen viewClassName="flex-1 items-center justify-center" loadingOverlay={true}>{null}</Screen>;
  }

  const legacyBlockedIds = Array.isArray(userData?.blockedUsers)
    ? (userData.blockedUsers as string[])
    : [];

  return (
    <Screen
      viewClassName="flex-1 px-2 sm:px-4"
      loadingOverlay={loading || uploadingImage}
    >
      <ScrollView
        className="flex-1 w-full"
        contentContainerStyle={{
          alignItems: 'center',
          gap: 16,
          paddingBottom: Math.max(insets.bottom, 24) + 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <View 
        className="items-center gap-3 w-full"
        style={{ paddingTop: Math.max(insets.top + 20, 40) }}
      >
        <ImageInput
          name={user?.displayName || user?.phoneNumber || 'User'}
          imageUri={profileImage.uri}
          onChangeImage={handleImageSelect}
        />
        {uploadingImage && (
          <Text className={clsx('text-xs', textSecondaryColor)}>{t('profile.uploading')}</Text>
        )}
        <Text className={clsx('text-sm', textSecondaryColor)}>
          {savedUsername || t('profile.chooseUsername')}
        </Text>
        <View className="flex-row items-center justify-center gap-2 mt-2">
          <ThemeToggle variant="profile" />
        </View>
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
        <View>
          <Text className={clsx('text-xs mb-1', textSecondaryColor)}>{t('auth.username')}</Text>
          <Text className={clsx('text-base', usernameTextColor)}>
            {savedUsername || '—'}
          </Text>
        </View>
        <TextField
          value={bio}
          placeholder={t('profile.bio')}
          onChangeText={onChangeBio}
          multiline
          numberOfLines={3}
        />
        <TextField
          value={phoneNumber}
          placeholder={t('auth.phoneNumber')}
          onChangeText={onChangePhoneNumber}
          keyboardType="phone-pad"
          editable={false}
        />
      </View>
      <Button onPress={updateProfile} disabled={submitDisabled}>
        {t('common.save')}
      </Button>

      <BlockedAccountsSection legacyBlockedIds={legacyBlockedIds} />
      
      <View className="mt-6 pt-6 border-t border-gray-300 dark:border-gray-700 w-full">
        <Button
          onPress={handleDeleteAccount}
          disabled={loading}
          variant="text"
          className="w-full"
        >
          <Text className="text-red-500 text-center font-medium">
            {t('profile.deleteAccount')}
          </Text>
        </Button>
        <Text className={clsx('text-xs text-center mt-2 px-4', textSecondaryColor)}>
          {t('profile.deleteAccountWarning')}
        </Text>
      </View>
      </ScrollView>
    </Screen>
  );
};

export default ProfileScreen;
