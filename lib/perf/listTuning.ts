import { Platform } from 'react-native';
import { isLegacyAndroid, isLowTierAndroid } from '@/lib/perf/deviceProfile';

export type FlatListTuning = {
  initialNumToRender: number;
  maxToRenderPerBatch: number;
  windowSize: number;
  updateCellsBatchingPeriod: number;
};

const IOS_CHAT_ROOM: FlatListTuning = {
  initialNumToRender: 14,
  maxToRenderPerBatch: 8,
  windowSize: 7,
  updateCellsBatchingPeriod: 50,
};

const IOS_CHATS_TAB: FlatListTuning = {
  initialNumToRender: 15,
  maxToRenderPerBatch: 10,
  windowSize: 10,
  updateCellsBatchingPeriod: 50,
};

/** Inverted message list in chat room — tightest on API 24–28. */
export function getChatRoomListTuning(): FlatListTuning {
  if (Platform.OS !== 'android') return IOS_CHAT_ROOM;
  if (isLegacyAndroid()) {
    return {
      initialNumToRender: 6,
      maxToRenderPerBatch: 4,
      windowSize: 4,
      updateCellsBatchingPeriod: 80,
    };
  }
  if (isLowTierAndroid()) {
    return {
      initialNumToRender: 7,
      maxToRenderPerBatch: 5,
      windowSize: 5,
      updateCellsBatchingPeriod: 80,
    };
  }
  return {
    initialNumToRender: 8,
    maxToRenderPerBatch: 6,
    windowSize: 5,
    updateCellsBatchingPeriod: 80,
  };
}

/** Chats tab main list. */
export function getChatsTabListTuning(): FlatListTuning {
  if (Platform.OS !== 'android') return IOS_CHATS_TAB;
  if (isLegacyAndroid()) {
    return {
      initialNumToRender: 7,
      maxToRenderPerBatch: 5,
      windowSize: 4,
      updateCellsBatchingPeriod: 80,
    };
  }
  if (isLowTierAndroid()) {
    return {
      initialNumToRender: 8,
      maxToRenderPerBatch: 6,
      windowSize: 5,
      updateCellsBatchingPeriod: 80,
    };
  }
  return {
    initialNumToRender: 12,
    maxToRenderPerBatch: 8,
    windowSize: 8,
    updateCellsBatchingPeriod: 60,
  };
}

/** Horizontal story rings on Stories tab. */
export function getStoriesRingListTuning(): FlatListTuning {
  if (Platform.OS !== 'android') {
    return {
      initialNumToRender: 8,
      maxToRenderPerBatch: 6,
      windowSize: 7,
      updateCellsBatchingPeriod: 40,
    };
  }
  if (isLowTierAndroid()) {
    return {
      initialNumToRender: 5,
      maxToRenderPerBatch: 4,
      windowSize: 5,
      updateCellsBatchingPeriod: 60,
    };
  }
  return {
    initialNumToRender: 6,
    maxToRenderPerBatch: 5,
    windowSize: 5,
    updateCellsBatchingPeriod: 50,
  };
}

/** Fixed chat row height: 56px avatar + py-3 (24px) + 1px border. */
export const CHAT_LIST_ROW_HEIGHT = 81;

export function getChatListItemLayout(_data: unknown, index: number) {
  return { length: CHAT_LIST_ROW_HEIGHT, offset: CHAT_LIST_ROW_HEIGHT * index, index };
}

/** Archived chats modal list. */
export function getArchivedChatsListTuning(): FlatListTuning {
  if (Platform.OS !== 'android') {
    return {
      initialNumToRender: 12,
      maxToRenderPerBatch: 8,
      windowSize: 8,
      updateCellsBatchingPeriod: 50,
    };
  }
  if (isLowTierAndroid()) {
    return {
      initialNumToRender: 8,
      maxToRenderPerBatch: 6,
      windowSize: 5,
      updateCellsBatchingPeriod: 80,
    };
  }
  return {
    initialNumToRender: 10,
    maxToRenderPerBatch: 7,
    windowSize: 7,
    updateCellsBatchingPeriod: 60,
  };
}
