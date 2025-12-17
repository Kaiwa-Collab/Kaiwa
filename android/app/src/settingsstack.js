import { createStackNavigator } from "@react-navigation/stack";
import Settings from "./screen/Settings";
import Addbio from "./screen/Addbio";


const Stack = createStackNavigator();

export default function SettingsStack() {
    return (
        <Stack.Navigator
screenOptions={{
  headerShown: false
}}
>
    <Stack.Screen name="Settings"
     component={Settings}
     options={({route})=>({


     })} 
     />
    <Stack.Screen name="Addbio" component={Addbio} />
</Stack.Navigator>
    );
}
