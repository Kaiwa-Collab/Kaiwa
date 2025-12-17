import { createStackNavigator } from "@react-navigation/stack";
import React from "react";
import Search from "./screen/Search";
import Notifications from "./screen/Notifications";

const Stack = createStackNavigator();


    export default function searchStack() {
     return (
        <Stack.Navigator
screenOptions={{
  headerShown: false
}}
>
    <Stack.Screen name="Search"
     component={Search}
     options={({route})=>({


     })} 
     />
    <Stack.Screen name="Notifications" component={Notifications} />
</Stack.Navigator>
    );
}
