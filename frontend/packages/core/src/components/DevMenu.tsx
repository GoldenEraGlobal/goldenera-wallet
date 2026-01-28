import { Preferences } from "@capacitor/preferences";
import {
    Button,
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger
} from "@project/ui";
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

const enabled = false

export function DrawerDemo() {

    const clearStorage = () => {
        localStorage.clear()
        SecureStoragePlugin.clear()
        Preferences.clear()
        window.location.replace('/')
    }

    if (!enabled) {
        return null
    }

    return (
        <Drawer>
            <DrawerTrigger render={(props) => (
                <Button variant="outline" {...props}>Open Dev Menu</Button>
            )} />
            <DrawerContent>
                <div className="mx-auto w-full max-w-sm">
                    <DrawerHeader>
                        <DrawerTitle>Dev Menu</DrawerTitle>
                    </DrawerHeader>
                    <div className="p-4 pb-0">
                        <Button onClick={clearStorage}>
                            Clear Storage
                        </Button>
                    </div>
                    <DrawerFooter>
                        <Button>Submit</Button>
                        <DrawerClose render={(props) => (
                            <Button variant="outline" {...props}>Cancel</Button>
                        )} />
                    </DrawerFooter>
                </div>
            </DrawerContent>
        </Drawer>
    )
}