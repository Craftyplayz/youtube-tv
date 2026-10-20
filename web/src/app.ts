// The Android app (android/) shows this page in a WebView and adds window.YoutubeTvApp; in a browser it's undefined.
// The app answers through events: 'app-pip' (detail: in picture-in-picture or not), 'app-command' (detail: a player
// command from the picture-in-picture buttons, or 'pause' on leaving the app) and a cancelable 'app-back' for the back button.
type Bridge = {
  enterPip(): void;
  rotate(landscape: boolean): void;
  setImmersive(on: boolean): void;
  setPlaying(on: boolean): void;
  changeServer(): void;
};

declare global {
  interface Window { YoutubeTvApp?: Bridge }
}

export const app = window.YoutubeTvApp;
