import { createStackNavigator } from "@react-navigation/stack";
import React from "react";
import Qna from "./screen/Qna";
import Answer from "./screen/Answer";

const Stack = createStackNavigator();


    export default function QnaStack() {
    return (
        <Stack.Navigator
screenOptions={{
  headerShown: false
}}
>
    <Stack.Screen name="Qna"
     component={Qna}
     options={({route})=>({


     })} 
     />
    <Stack.Screen name="Answer" component={Answer} />
</Stack.Navigator>
    );
}
