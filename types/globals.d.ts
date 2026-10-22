// 에디터용 최소 타입. 실제 API는 Revenge Next가 런타임에 `revenge` 전역으로 넘겨준다
declare function plugin<T extends object>(options: T): T
declare module '@revenge-mod/*'
declare module 'react-native'
