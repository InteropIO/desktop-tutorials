declare const iodesktop: {
  theme: string;
};

declare const IOWorkspaces: any;

declare function IODesktop(config?: {
  libraries?: any[];
  channels?: boolean;
  appManager?: string;
}): Promise<IODesktopAPI>;

interface IODesktopAPI {
  windows: {
    open(name: string, url: string, config: any): Promise<any>;
    list(): any[];
  };
  interop: {
    methods(): { name: string; }[];
    invoke(method: any, args: any): Promise<any>;
  };
  contexts: {
    update(name: string, context: any): Promise<any>;
  };
  channels: {
    my(): any;
    publish(data: any): Promise<any>;
    subscribe(handler: (data: any) => void): void;
  };
  workspaces: {
    getMyWorkspace(): Promise<Workspace>;
    restoreWorkspace(name: string, config: any): Promise<Workspace>;
  };
  notifications: {
    raise(options: NotificationOptions): Promise<Notification>;
  };
  themes: {
    onChanged(handler: (theme: Theme) => void): void;
    getCurrent(): Promise<Theme>;
    select(themeName: string): void;
  };
  hotkeys: {
    register(hotkey: Hotkey, handler: () => void): void;
  };
  intents: {
    register(name: string, handler: (context: any) => void): void;
  };
  appManager: {
    application(name: string): {
      start(context?: any, options?: any): Promise<any>;
      instances: any[];
    };
  };
}

interface Workspace {
  frame: {
    focus(): Promise<void>;
  };
  focus(): Promise<void>;
  setTitle(title: string): void;
  onContextUpdated(handler: (context: any) => void): void;
}

interface Theme {
  name: string;
}

interface Hotkey {
  hotkey: string;
  description: string;
}

interface NotificationOptions {
  title: string;
  body: string;
}

interface Notification {
  onclick: () => void;
}

declare interface Client {
  name: string;
  pId?: string;
  gId?: string;
  id?: string;
  eId?: string;
  accountManager?: string;
  address?: string;
  contactNumbers?: string;
  email?: string;
  portfolio?: string;
}

declare interface Stock {
  RIC: string;
  description: string;
  price?: number;
  updateTime?: string;
}