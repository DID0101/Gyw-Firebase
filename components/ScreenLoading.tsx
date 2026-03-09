import Screen from './Screen';
import Spinner from './Spinner';
import { useTheme } from '@/contexts/ThemeContext';

const ScreenLoading = () => {
  const { isDark } = useTheme();
  
  return (
    <Screen viewClassName={`items-center justify-center ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
      <Spinner />
    </Screen>
  );
};

export default ScreenLoading;
