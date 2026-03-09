import { useState } from 'react';

interface InitialValues {
  firstName?: string;
  lastName?: string;
  username?: string;
  usernameNumber?: string;
  numberError?: string;
  phoneNumber?: string;
  bio?: string;
}

const defaultValues: InitialValues = {
  firstName: '',
  lastName: '',
  username: '',
  usernameNumber: '',
  numberError: '',
  phoneNumber: '',
  bio: '',
};

const useUserForm = (initialValues = defaultValues) => {
  const [firstName, setFirstName] = useState(initialValues.firstName || '');
  const [lastName, setLastName] = useState(initialValues.lastName || '');
  const [username, setUsername] = useState(initialValues.username || '');
  const [usernameNumber, setUsernameNumber] = useState(
    initialValues.usernameNumber || ''
  );
  const [numberError, setNumberError] = useState(
    initialValues.numberError || ''
  );
  const [phoneNumber, setPhoneNumber] = useState(
    initialValues.phoneNumber || ''
  );
  const [bio, setBio] = useState(initialValues.bio || '');

  const onChangeUsername = (text: string) => {
    setUsername(text);
    if (!usernameNumber) {
      const randomNumber = String(Math.floor(Math.random() * 99) + 1).padStart(
        2,
        '0'
      );
      setUsernameNumber(randomNumber);
      setNumberError('');
    }
  };

  const onChangeNumber = (number: string) => {
    if (number === '00') return;
    setUsernameNumber(number);

    const isNumber = /^\d+$/.test(number);
    const isValid = isNumber && number.length === 2;

    if (!isValid) {
      setNumberError('Invalid username, enter a minimum of 2 digits');
    } else {
      setNumberError('');
    }
  };

  const onChangeFirstName = (text: string) => {
    setFirstName(text);
  };

  const onChangeLastName = (text: string) => {
    setLastName(text);
  };

  const onChangeBio = (text: string) => {
    setBio(text);
  };

  const onChangePhoneNumber = (text: string) => {
    // Remove any non-digit characters except +
    let cleaned = text.replace(/[^\d+]/g, '');
    // Ensure it starts with + if it doesn't already
    if (cleaned && !cleaned.startsWith('+')) {
      cleaned = '+' + cleaned.replace(/\D/g, '');
    }
    setPhoneNumber(cleaned);
  };

  return {
    firstName,
    lastName,
    username,
    usernameNumber,
    numberError,
    phoneNumber,
    bio,
    onChangeNumber,
    onChangeUsername,
    onChangeFirstName,
    onChangeLastName,
    onChangePhoneNumber,
    onChangeBio,
  };
};

export default useUserForm;
