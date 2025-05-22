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
// const toggleIOAvailable = (): void => {
//     const span = document.getElementById("ioConnectSpan");
//     if (!span) return;

//     span.classList.remove("bg-danger");
//     span.classList.add("bg-success");
//     span.textContent = "io.Connect is available";
// };

const start = async (): Promise<void> => {
    // TODO: Chapter 3

    // TODO: Chapter 12.1

    // TODO: Chapter 9.4
};

// Add window properties when needed
declare global {
    interface Window {
        io?: IODesktopAPI;
    }
}

start().catch(console.error);