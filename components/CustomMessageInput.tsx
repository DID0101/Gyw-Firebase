import { useTranslation } from 'react-i18next';
import { TextComposerState } from 'stream-chat';
import {
  MessageInput,
  useAttachmentManagerState,
  useMessageComposer,
  useStateStore,
} from 'stream-chat-expo';

const textComposerStateSelector = (state: TextComposerState) => ({
  text: state.text,
});

const CustomMessageInput = () => {
  const { t } = useTranslation();
  const { textComposer } = useMessageComposer();
  const { text } = useStateStore(textComposer.state, textComposerStateSelector);
  const { attachments } = useAttachmentManagerState();

  const audioRecordingEnabled = !text && attachments.length === 0;
  return (
    <MessageInput
      audioRecordingEnabled={audioRecordingEnabled}
      placeholder={t('messages.typeMessage')}
    />
  );
};

export default CustomMessageInput;
