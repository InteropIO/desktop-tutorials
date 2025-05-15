const setFields = (client) => {
    const elementName = document.querySelectorAll("[data-name]")[0];
    elementName.innerText = client.name;

    const elementAddress = document.querySelectorAll("[data-address]")[0];
    elementAddress.innerText = client.address;

    const elementPhone = document.querySelectorAll("[data-phone]")[0];
    elementPhone.innerText = client.contactNumbers;

    const elementOccupation = document.querySelectorAll("[data-email]")[0];
    elementOccupation.innerText = client.email;

    const elementManager = document.querySelectorAll("[data-manager]")[0];
    elementManager.innerText = client.accountManager;
};

// TODO: Chapter 3
const toggleIOAvailable = () => {
    const span = document.getElementById("ioConnectSpan");

    span.classList.remove("bg-danger");
    span.classList.add("bg-success");
    span.textContent = "io.Connect is available";
};

const start = async () => {
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
    const themeHandler = (newTheme) => {
        html.className = newTheme.name;
    };

    io.themes.onChanged(themeHandler);

    // TODO: Chapter 9.4
    const myWorkspace = await io.workspaces.getMyWorkspace();

    if (myWorkspace) {
        const updateHandler = (context) => {
            if (context.client) {
                setFields(context.client);
                myWorkspace.setTitle(context.client.name);
            };
        };

        myWorkspace.onContextUpdated(updateHandler);
    };
};

start().catch(console.error);