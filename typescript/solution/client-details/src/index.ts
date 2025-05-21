const setFields = (client: Client): void => {
    const elementName = document.querySelectorAll("[data-name]")[0] as HTMLElement;
    if (elementName) elementName.innerText = client.name;

    const elementAddress = document.querySelectorAll("[data-address]")[0] as HTMLElement;
    if (elementAddress) elementAddress.innerText = client.address || '';

    const elementPhone = document.querySelectorAll("[data-phone]")[0] as HTMLElement;
    if (elementPhone) elementPhone.innerText = client.contactNumbers || '';

    const elementOccupation = document.querySelectorAll("[data-email]")[0] as HTMLElement;
    if (elementOccupation) elementOccupation.innerText = client.email || '';

    const elementManager = document.querySelectorAll("[data-manager]")[0] as HTMLElement;
    if (elementManager) elementManager.innerText = client.accountManager || '';
};

// TODO: Chapter 3
const toggleIOAvailable = (): void => {
    const span = document.getElementById("ioConnectSpan");
    if (!span) return;

    span.classList.remove("bg-danger");
    span.classList.add("bg-success");
    span.textContent = "io.Connect is available";
};

const start = async (): Promise<void> => {
    const html = document.documentElement;
    const initialTheme = iodesktop.theme;

    html.className = initialTheme;

    // TODO: Chapter 3
    const config = {
        libraries: [IOWorkspaces]
    };

    const io = await IODesktop(config);

    window.io = io;

    toggleIOAvailable();

    // TODO: Chapter 12.1
    const themeHandler = (newTheme: Theme): void => {
        html.className = newTheme.name;
    };

    io.themes.onChanged(themeHandler);

    // TODO: Chapter 9.4
    const myWorkspace = await io.workspaces.getMyWorkspace();

    if (myWorkspace) {
        const updateHandler = (context: any): void => {
            if (context.client) {
                setFields(context.client);
                myWorkspace.setTitle(context.client.name);
            }
        };

        myWorkspace.onContextUpdated(updateHandler);
    }
};

// Add io property to window object
declare global {
    interface Window {
        io: IODesktopAPI;
    }
}

start().catch(console.error);